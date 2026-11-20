CREATE TYPE ppt.submission_effect_outcome AS (result jsonb, account_change jsonb, warnings jsonb);

CREATE FUNCTION ppt.require_resolved_submission_effects(
  p_class_id text, p_task_id text, p_student_id text, p_status ppt.submission_status
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  unresolved jsonb;
BEGIN
  IF p_status = 'makeup' THEN
    RETURN;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('effect_id', effect_id) ORDER BY effect_id COLLATE "C")
  INTO unresolved FROM effects
  WHERE class_id = p_class_id AND student_id = p_student_id
    AND subject_kind = 'task' AND subject_key = p_task_id AND status = 'legacy_unresolved';

  IF unresolved IS NOT NULL THEN
    PERFORM reject_operation('LEGACY_EFFECT_UNRESOLVED', jsonb_build_object('unresolved_legacy_effects', unresolved));
  END IF;
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
    RETURN (operation_result(), NULL, '[]'::jsonb)::submission_effect_outcome;
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

  RETURN (operation_result(transaction_ids, added, reversed), account_change, '[]'::jsonb)::submission_effect_outcome;
END;
$$;
