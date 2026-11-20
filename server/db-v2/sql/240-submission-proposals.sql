CREATE FUNCTION ppt.validate_submission_proposal(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['task_id', 'student_id', 'proposed_status'])
    OR NOT has_nonempty_string(p_payload, 'task_id')
    OR NOT has_nonempty_string(p_payload, 'student_id')
    OR NOT has_nonempty_string(p_payload, 'proposed_status')
    OR p_payload->>'proposed_status' NOT IN ('on_time', 'late', 'missing', 'pending') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_pending_submission(p_submission ppt.submissions)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT coalesce(p_submission.assignment_active AND p_submission.status IN ('pending', 'unknown'), false) THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_proposal_target(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  task_key text := payload->>'task_id';
  student_key text := payload->>'student_id';
  target submissions := load_submission(class_key, task_key, student_key);
BEGIN
  IF target.assignment_active IS NOT TRUE THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF payload->>'proposed_status' <> 'pending' THEN
    PERFORM require_submission_targets(class_key, task_key, student_key, p_actor);
    PERFORM require_pending_submission(target);
  END IF;
END;
$$;

CREATE FUNCTION ppt.confirmation_processing_value(p_row ppt.confirmations)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
  SELECT jsonb_build_object(
    'status', p_row.status, 'processed_op_id', p_row.processed_op_id, 'processed_at', p_row.processed_at
  );
$$;

CREATE FUNCTION ppt.create_submission_proposal(p_op jsonb, p_time timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  inserted confirmations;
BEGIN
  INSERT INTO confirmations (
    class_id, confirmation_id, kind, task_id, student_id, proposed_status, created_op_id, created_at, last_op_id
  ) VALUES (
    p_op->>'class_id', op_key, 'leader_proposal', payload->>'task_id', payload->>'student_id',
    (payload->>'proposed_status')::submission_status, op_key, p_time, op_key
  ) RETURNING * INTO inserted;

  RETURN entity_change(
    'confirmation', jsonb_build_object('confirmation_id', inserted.confirmation_id),
    0, inserted.rev, op_key, NULL, confirmation_processing_value(inserted) || jsonb_build_object(
      'kind', inserted.kind, 'task_id', inserted.task_id, 'student_id', inserted.student_id,
      'proposed_status', inserted.proposed_status, 'created_op_id', inserted.created_op_id, 'created_at', inserted.created_at
    )
  );
END;
$$;

CREATE FUNCTION ppt.store_confirmation_status(
  p_before ppt.confirmations, p_status ppt.confirmation_status, p_op_id text, p_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  updated confirmations;
BEGIN
  UPDATE confirmations
  SET status = p_status, processed_op_id = p_op_id, processed_at = p_time, last_op_id = p_op_id, rev = rev + 1
  WHERE class_id = p_before.class_id AND confirmation_id = p_before.confirmation_id
  RETURNING * INTO STRICT updated;
  RETURN entity_change(
    'confirmation', jsonb_build_object('confirmation_id', updated.confirmation_id),
    p_before.rev, updated.rev, p_op_id, confirmation_processing_value(p_before), confirmation_processing_value(updated)
  );
END;
$$;

CREATE FUNCTION ppt.pending_submission_proposal(p_class_id text, p_task_id text, p_student_id text)
RETURNS ppt.confirmations
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM confirmations
  WHERE class_id = p_class_id AND task_id = p_task_id AND student_id = p_student_id
    AND kind = 'leader_proposal' AND status = 'pending';
$$;

CREATE FUNCTION ppt.require_no_submission_proposal(p_op jsonb, p_previous ppt.submissions)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  proposal confirmations;
  current_state jsonb;
BEGIN
  IF (payload->>'only_if_no_proposal')::boolean IS NOT TRUE THEN
    RETURN;
  END IF;
  proposal := pending_submission_proposal(class_key, payload->>'task_id', payload->>'student_id');
  IF proposal.confirmation_id IS NOT NULL THEN
    current_state := current_entity_revision(
      class_key, p_previous.last_op_id, p_previous.rev, submission_value(p_previous)
    );
    PERFORM reject_operation('STALE_STATE', current_state || jsonb_build_object('proposal', jsonb_build_object(
      'confirmation_id', proposal.confirmation_id, 'proposed_status', proposal.proposed_status,
      'status', proposal.status, 'proposed_at', proposal.created_at
    )));
  END IF;
END;
$$;

CREATE FUNCTION ppt.supersede_submission_proposal(
  p_class_id text, p_task_id text, p_student_id text, p_op_id text, p_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous confirmations := pending_submission_proposal(p_class_id, p_task_id, p_student_id);
BEGIN
  IF previous.confirmation_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN jsonb_build_array(store_confirmation_status(previous, 'superseded', p_op_id, p_time));
END;
$$;

CREATE FUNCTION ppt.supersede_task_proposals(p_task ppt.tasks, p_op_id text, p_time timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  proposal confirmations;
  changes jsonb := '[]';
BEGIN
  FOR proposal IN
    SELECT * FROM confirmations
    WHERE class_id = p_task.class_id AND task_id = p_task.task_id AND kind = 'leader_proposal' AND status = 'pending'
    ORDER BY student_id COLLATE "C"
  LOOP
    changes := changes || jsonb_build_array(store_confirmation_status(proposal, 'superseded', p_op_id, p_time));
  END LOOP;
  RETURN changes;
END;
$$;

CREATE FUNCTION ppt.apply_submission_proposal(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  changes jsonb;
BEGIN
  changes := supersede_submission_proposal(
    p_op->>'class_id', payload->>'task_id', payload->>'student_id', p_op->>'op_id', p_time
  );
  IF payload->>'proposed_status' <> 'pending' THEN
    changes := changes || jsonb_build_array(create_submission_proposal(p_op, p_time));
  END IF;
  RETURN (operation_result(p_noop => changes = '[]'::jsonb), changes, '[]'::jsonb)::operation_outcome;
END;
$$;
