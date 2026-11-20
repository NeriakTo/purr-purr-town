CREATE FUNCTION ppt.validate_confirmation_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['confirmation_id'])
    OR NOT has_nonempty_string(p_payload, 'confirmation_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_pending_confirmation(p_class_id text, p_confirmation_id text)
RETURNS ppt.confirmations
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target confirmations;
BEGIN
  SELECT * INTO target FROM confirmations
  WHERE class_id = p_class_id AND confirmation_id = p_confirmation_id;
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF target.status <> 'pending' THEN
    PERFORM reject_operation('CONFIRMATION_NOT_PENDING');
  END IF;
  IF target.kind = 'agent_held' THEN
    -- PPT-PENDING: agent_held_confirmation
    PERFORM pending_operation('agent_held_confirmation');
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.require_confirmation_submission(p_confirmation ppt.confirmations, p_actor jsonb)
RETURNS ppt.submissions
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target submissions;
BEGIN
  PERFORM require_submission_targets(p_confirmation.class_id, p_confirmation.task_id, p_confirmation.student_id, p_actor);
  target := load_submission(p_confirmation.class_id, p_confirmation.task_id, p_confirmation.student_id);
  PERFORM require_pending_submission(target);
  PERFORM require_resolved_submission_effects(p_confirmation.class_id, p_confirmation.task_id, p_confirmation.student_id);
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.apply_confirmation_operation(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_key text := p_op->>'op_id';
  target confirmations := require_pending_confirmation(p_op->>'class_id', p_op->'payload'->>'confirmation_id');
  previous submissions;
  outcome operation_outcome;
BEGIN
  IF p_op->>'type' = 'confirmation.reject' THEN
    RETURN (
      operation_result(), jsonb_build_array(store_confirmation_status(target, 'rejected', op_key, p_time)), '[]'::jsonb
    )::operation_outcome;
  END IF;
  previous := require_confirmation_submission(target, p_actor);
  outcome := write_submission_change(
    target.class_id, target.task_id, target.student_id, previous, target.proposed_status, op_key, p_time
  );
  outcome.changes := outcome.changes || jsonb_build_array(store_confirmation_status(target, 'confirmed', op_key, p_time));
  RETURN outcome;
END;
$$;
