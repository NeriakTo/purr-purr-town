ALTER TYPE ppt.operation_code ADD VALUE 'SCOPE_FORBIDDEN';

CREATE FUNCTION ppt.validate_submission_status(p_payload jsonb, p_expect jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'task_id') IS DISTINCT FROM 'string'
    OR p_payload->>'task_id' = ''
    OR jsonb_typeof(p_payload->'student_id') IS DISTINCT FROM 'string'
    OR p_payload->>'student_id' = ''
    OR p_payload->>'status' IS NULL
    OR p_payload->>'status' NOT IN ('pending', 'on_time', 'late', 'missing', 'leave', 'exempt', 'makeup')
    OR (p_payload ? 'only_if_no_proposal' AND jsonb_typeof(p_payload->'only_if_no_proposal') <> 'boolean')
    OR p_payload - ARRAY['task_id', 'student_id', 'status', 'only_if_no_proposal'] <> '{}'::jsonb THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_version_condition(p_expect);
END;
$$;

CREATE FUNCTION ppt.require_submission_targets(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  task_voided boolean;
  enrollment text;
BEGIN
  SELECT voided INTO task_voided FROM tasks
  WHERE class_id = class_key AND task_id = payload->>'task_id';

  SELECT enrollment_status INTO enrollment FROM students
  WHERE class_id = class_key AND student_id = payload->>'student_id';

  IF task_voided IS NULL OR enrollment IS NULL THEN
    IF p_actor->>'kind' = 'agent' THEN
      PERFORM reject_operation('SCOPE_FORBIDDEN');
    END IF;
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF task_voided OR enrollment IN ('transferred', 'archived') THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.submission_value(p_row ppt.submissions)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_row.rev IS NOT NULL THEN
    jsonb_build_object('status', p_row.status, 'assignment_active', p_row.assignment_active)
  END;
$$;

CREATE FUNCTION ppt.store_submission_status(p_op jsonb, p_status ppt.submission_status)
RETURNS ppt.submissions
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO submissions (class_id, task_id, student_id, status, last_op_id)
  VALUES (p_op->>'class_id', p_op->'payload'->>'task_id', p_op->'payload'->>'student_id', p_status, p_op->>'op_id')
  ON CONFLICT (class_id, task_id, student_id) DO UPDATE
  SET status = excluded.status, assignment_active = true, rev = submissions.rev + 1,
      basis_rev = submissions.rev + 1, last_op_id = excluded.last_op_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.submission_change(
  p_before ppt.submissions, p_after ppt.submissions, p_key jsonb, p_op_id text
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'entity', 'submission', 'key', p_key, 'last_op_id', p_op_id,
    'prev_rev', coalesce(p_before.rev, 0), 'rev', p_after.rev,
    'prev_basis_rev', coalesce(p_before.basis_rev, 0), 'basis_rev', p_after.basis_rev,
    'prev_value', submission_value(p_before), 'value', submission_value(p_after)
  );
$$;

CREATE FUNCTION ppt.apply_submission_status(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  op_key text := p_op->>'op_id';
  payload jsonb := p_op->'payload';
  entity_key jsonb := jsonb_build_object('task_id', payload->'task_id', 'student_id', payload->'student_id');
  new_status submission_status := (payload->>'status')::submission_status;
  previous submissions;
  updated submissions;
  outcome submission_effect_outcome;
  changes jsonb;
BEGIN
  SELECT * INTO previous FROM submissions
  WHERE class_id = class_key AND task_id = payload->>'task_id' AND student_id = payload->>'student_id';
  IF NOT matches_version_condition(
    class_key, p_op->'expect', 'submission', entity_key, previous.rev, NOT coalesce(previous.assignment_active, false)
  ) THEN
    PERFORM reject_operation('STALE_STATE',
      current_entity_revision(class_key, previous.last_op_id, previous.rev, submission_value(previous)));
  END IF;

  PERFORM check_pending_submission_branches(p_op);
  IF previous.assignment_active AND previous.status = new_status THEN
    RETURN (
      operation_result(p_noop => true),
      jsonb_build_array(submission_change(previous, previous, entity_key, op_key)), '[]'::jsonb
    )::operation_outcome;
  END IF;

  updated := store_submission_status(p_op, new_status);
  outcome := apply_submission_effects(updated, op_key, p_time);
  changes := jsonb_build_array(submission_change(previous, updated, entity_key, op_key));
  IF outcome.account_change IS NOT NULL THEN
    changes := changes || jsonb_build_array(outcome.account_change);
  END IF;
  RETURN (outcome.result, changes, '[]'::jsonb)::operation_outcome;
END;
$$;
