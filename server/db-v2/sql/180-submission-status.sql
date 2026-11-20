CREATE FUNCTION ppt.validate_submission_status(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT is_json_object(p_payload)
    OR NOT has_nonempty_string(p_payload, 'task_id')
    OR NOT has_nonempty_string(p_payload, 'student_id')
    OR p_payload->>'status' IS NULL
    OR p_payload->>'status' NOT IN ('pending', 'on_time', 'late', 'missing', 'leave', 'exempt', 'makeup')
    OR (p_payload ? 'only_if_no_proposal' AND jsonb_typeof(p_payload->'only_if_no_proposal') <> 'boolean')
    OR NOT has_only_keys(p_payload, ARRAY['task_id', 'student_id', 'status', 'only_if_no_proposal']) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
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
  SELECT entity_change(
    'submission', p_key, coalesce(p_before.rev, 0), p_after.rev, p_op_id,
    submission_value(p_before), submission_value(p_after)
  ) || jsonb_build_object(
    'prev_basis_rev', coalesce(p_before.basis_rev, 0), 'basis_rev', p_after.basis_rev
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
  daily submission_effect_outcome;
  due_date date;
  changes jsonb;
BEGIN
  SELECT * INTO previous FROM submissions
  WHERE class_id = class_key AND task_id = payload->>'task_id' AND student_id = payload->>'student_id';
  PERFORM require_version_condition(
    p_op, 'submission', entity_key, previous.rev, previous.last_op_id,
    submission_value(previous), NOT coalesce(previous.assignment_active, false)
  );

  PERFORM check_pending_submission_branches(p_op);
  IF previous.assignment_active AND previous.status = new_status THEN
    RETURN (
      operation_result(p_noop => true),
      jsonb_build_array(submission_change(previous, previous, entity_key, op_key)), '[]'::jsonb
    )::operation_outcome;
  END IF;

  updated := store_submission_status(p_op, new_status);
  outcome := apply_submission_effects(updated, op_key, p_time);
  SELECT due_on INTO STRICT due_date FROM tasks WHERE class_id = class_key AND task_id = updated.task_id;
  daily := apply_daily_quest(class_key, updated.student_id, due_date, op_key, p_time);
  IF daily.account_change IS NOT NULL THEN
    outcome.account_change := merge_account_change(outcome.account_change, daily.account_change);
  END IF;
  changes := jsonb_build_array(submission_change(previous, updated, entity_key, op_key));
  IF outcome.account_change IS NOT NULL THEN
    changes := changes || jsonb_build_array(outcome.account_change);
  END IF;
  RETURN (operation_result(
    (outcome.result->'transactions') || (daily.result->'transactions'),
    (outcome.result->'effects_added') || (daily.result->'effects_added'),
    (outcome.result->'effects_reversed') || (daily.result->'effects_reversed')
  ), changes, daily.warnings)::operation_outcome;
END;
$$;
