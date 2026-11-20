CREATE FUNCTION ppt.validate_task_lifecycle(p_payload jsonb, p_voiding boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_nonempty_string(p_payload, 'task_id')
    OR NOT has_only_keys(p_payload, CASE WHEN p_voiding THEN ARRAY['task_id', 'reverse_effects'] ELSE ARRAY['task_id'] END)
    OR (p_voiding AND jsonb_typeof(p_payload->'reverse_effects') IS DISTINCT FROM 'boolean') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_task_lifecycle_version(p_op jsonb, p_task ppt.tasks, p_voiding boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT p_voiding AND NOT p_task.voided THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
  PERFORM require_version_condition(
    p_op, 'task', jsonb_build_object('task_id', p_task.task_id),
    p_task.rev, p_task.last_op_id, task_value(p_task)
  );
END;
$$;

CREATE FUNCTION ppt.require_resolved_task_effects(p_task ppt.tasks)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM effects
    WHERE class_id = p_task.class_id AND subject_kind = 'task' AND subject_key = p_task.task_id
      AND status = 'legacy_unresolved'
  ) THEN
    -- PPT-PENDING: task_void_legacy_effects
    PERFORM pending_operation('task_void_legacy_effects');
  END IF;
END;
$$;

CREATE FUNCTION ppt.reverse_task_effects(p_task ppt.tasks, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  effect effects;
  reversal effect_write;
  student_key text;
  account_change jsonb;
  accounts jsonb := '[]';
  transactions jsonb := '[]';
  reversed jsonb := '[]';
BEGIN
  FOR effect IN
    SELECT * FROM effects
    WHERE class_id = p_task.class_id AND subject_kind = 'task' AND subject_key = p_task.task_id AND status = 'active'
    ORDER BY student_id COLLATE "C", event::text COLLATE "C"
  LOOP
    IF student_key IS DISTINCT FROM effect.student_id THEN
      IF account_change IS NOT NULL THEN
        accounts := accounts || jsonb_build_array(account_change);
      END IF;
      student_key := effect.student_id;
      account_change := NULL;
    END IF;
    reversal := reverse_event_effect(effect, p_op_id, p_time);
    account_change := merge_account_change(account_change, (reversal.entry).account_change);
    transactions := transactions || jsonb_build_array((reversal.entry).transaction_id);
    reversed := reversed || jsonb_build_array(reversal.snapshot);
  END LOOP;
  IF account_change IS NOT NULL THEN
    accounts := accounts || jsonb_build_array(account_change);
  END IF;

  RETURN (operation_result(transactions, p_effects_reversed => reversed), accounts, '[]'::jsonb)::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.apply_task_lifecycle(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  previous tasks := require_task(p_op->>'class_id', payload->>'task_id');
  entity_key jsonb := jsonb_build_object('task_id', previous.task_id);
  voiding boolean := p_op->>'type' = 'task.void';
  unchanged boolean := previous.voided = voiding;
  reverse_effects boolean := voiding AND (payload->>'reverse_effects')::boolean;
  new_rev integer := previous.rev;
  outcome operation_outcome := (operation_result(p_noop => unchanged), '[]'::jsonb, '[]'::jsonb);
BEGIN
  PERFORM require_task_lifecycle_version(p_op, previous, voiding);

  IF NOT unchanged THEN
    IF reverse_effects THEN
      PERFORM require_resolved_task_effects(previous);
    END IF;

    UPDATE tasks SET voided = voiding, rev = rev + 1, last_op_id = op_key
    WHERE class_id = previous.class_id AND task_id = previous.task_id
    RETURNING rev INTO STRICT new_rev;

    IF reverse_effects THEN
      outcome := reverse_task_effects(previous, op_key, p_time);
    END IF;
    IF voiding THEN
      outcome.changes := outcome.changes || supersede_task_proposals(previous, op_key, p_time);
    END IF;
  END IF;

  outcome.changes := jsonb_build_array(entity_change(
    'task', entity_key, previous.rev, new_rev, op_key,
    jsonb_build_object('voided', previous.voided), jsonb_build_object('voided', voiding)
  )) || outcome.changes;
  RETURN outcome;
END;
$$;
