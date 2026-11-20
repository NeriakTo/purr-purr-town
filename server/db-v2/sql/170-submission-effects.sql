CREATE TYPE ppt.submission_effect_outcome AS (result jsonb, account_change jsonb);

CREATE FUNCTION ppt.check_pending_submission_branches(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
BEGIN
  IF payload ? 'only_if_no_proposal' THEN
    -- PPT-PENDING: only_if_no_proposal
    PERFORM pending_operation('only_if_no_proposal');
  END IF;

  IF EXISTS (
    SELECT 1 FROM effects
    WHERE class_id = class_key AND student_id = payload->>'student_id'
      AND subject_kind = 'task' AND subject_key = payload->>'task_id'
      AND status = 'legacy_unresolved'
  ) THEN
    -- PPT-PENDING: legacy_unresolved
    PERFORM pending_operation('legacy_unresolved');
  END IF;

  IF (current_event_rule(class_key, 'daily_quest.complete')).amount <> 0 THEN
    -- PPT-PENDING: daily_quest
    PERFORM pending_operation('daily_quest');
  END IF;
END;
$$;

CREATE FUNCTION ppt.merge_account_change(p_first jsonb, p_latest jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_first IS NULL THEN p_latest ELSE
    p_latest || jsonb_build_object('prev_rev', p_first->'prev_rev', 'prev_value', p_first->'prev_value')
  END;
$$;

CREATE FUNCTION ppt.apply_submission_effects(p_submission ppt.submissions, p_op_id text, p_time timestamptz)
RETURNS ppt.submission_effect_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  wanted rule_event;
  effect effects;
  write_result effect_write;
  transaction_ids jsonb := '[]';
  added jsonb := '[]';
  reversed jsonb := '[]';
  account_change jsonb;
  kept_effect boolean := false;
BEGIN
  IF p_submission.status = 'makeup' THEN
    RETURN (operation_result(), NULL)::submission_effect_outcome;
  END IF;

  wanted := CASE p_submission.status
    WHEN 'late' THEN 'submission.late'::rule_event
    WHEN 'missing' THEN 'submission.missing'::rule_event
    ELSE NULL
  END;
  FOR effect IN
    SELECT * FROM effects
    WHERE class_id = p_submission.class_id AND student_id = p_submission.student_id
      AND subject_kind = 'task' AND subject_key = p_submission.task_id
      AND status = 'active' AND event IN ('submission.late', 'submission.missing')
    ORDER BY event
  LOOP
    IF effect.event = wanted THEN
      kept_effect := true;
      CONTINUE;
    END IF;
    write_result := reverse_event_effect(effect, p_op_id, p_time);
    reversed := reversed || jsonb_build_array(write_result.snapshot);
    transaction_ids := transaction_ids || jsonb_build_array((write_result.entry).transaction_id);
    account_change := merge_account_change(account_change, (write_result.entry).account_change);
  END LOOP;

  IF wanted IS NOT NULL AND NOT kept_effect THEN
    write_result := add_event_effect(
      p_submission.class_id, p_submission.student_id, wanted, 'task', p_submission.task_id, p_op_id, p_time
    );
    IF write_result.snapshot IS NOT NULL THEN
      added := jsonb_build_array(write_result.snapshot);
      transaction_ids := transaction_ids || jsonb_build_array((write_result.entry).transaction_id);
      account_change := merge_account_change(account_change, (write_result.entry).account_change);
    END IF;
  END IF;

  RETURN (operation_result(transaction_ids, added, reversed), account_change)::submission_effect_outcome;
END;
$$;
