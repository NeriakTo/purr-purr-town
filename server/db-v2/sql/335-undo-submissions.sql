CREATE FUNCTION ppt.receipt_entity_change(p_receipt jsonb, p_entity text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT change FROM jsonb_array_elements(p_receipt->'changes') AS change
  WHERE change->>'entity' = p_entity;
$$;

CREATE FUNCTION ppt.undo_submission_current(p_row ppt.submissions)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT current_entity_revision(p_row.class_id, p_row.last_op_id, p_row.rev, submission_value(p_row))
    || jsonb_build_object('basis_rev', p_row.basis_rev);
$$;

CREATE FUNCTION ppt.check_undo_submission(p_target ppt.operations, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  change jsonb := receipt_entity_change(p_target.receipt, 'submission');
  task_key text := change->'key'->>'task_id';
  student_key text := change->'key'->>'student_id';
  current_row submissions;
  blocking_effect text;
BEGIN
  PERFORM require_submission_targets(p_target.class_id, task_key, student_key, p_actor);
  current_row := load_submission(p_target.class_id, task_key, student_key);
  IF current_row.basis_rev IS DISTINCT FROM (change->>'rev')::integer THEN
    PERFORM reject_undo_conflict(p_actor, 'basis_changed', undo_submission_current(current_row));
  END IF;

  blocking_effect := undo_effect_conflict(p_target.class_id, student_key, p_target.receipt->'result');
  IF blocking_effect IS NOT NULL THEN
    PERFORM reject_undo_conflict(p_actor, 'effect_already_active',
      undo_submission_current(current_row) || jsonb_build_object('effect_id', blocking_effect));
  END IF;
END;
$$;

CREATE FUNCTION ppt.restore_submission_row(p_current ppt.submissions, p_change jsonb, p_op_id text)
RETURNS ppt.submissions
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous_value jsonb := p_change->'prev_value';
  active boolean := previous_value <> 'null'::jsonb AND (previous_value->>'assignment_active')::boolean IS TRUE;
  restored submissions;
BEGIN
  UPDATE submissions
  SET rev = rev + 1, last_op_id = p_op_id, assignment_active = active,
    status = CASE WHEN active THEN (previous_value->>'status')::submission_status ELSE 'pending' END,
    basis_rev = CASE WHEN active THEN (p_change->>'prev_basis_rev')::integer ELSE 0 END
  WHERE class_id = p_current.class_id AND task_id = p_current.task_id AND student_id = p_current.student_id
  RETURNING * INTO STRICT restored;
  RETURN restored;
END;
$$;

CREATE FUNCTION ppt.undo_submission(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  change jsonb := receipt_entity_change(p_target.receipt, 'submission');
  task_key text := change->'key'->>'task_id';
  student_key text := change->'key'->>'student_id';
  current_row submissions := load_submission(p_target.class_id, task_key, student_key);
  restored submissions;
  effect_outcome submission_effect_outcome;
  outcome operation_outcome;
BEGIN
  restored := restore_submission_row(current_row, change, p_op_id);
  effect_outcome := undo_event_effects(p_target.class_id, student_key, p_target.receipt->'result', p_op_id, p_time);
  outcome := finish_submission_change(current_row, restored, effect_outcome, p_op_id, p_time);
  outcome.warnings := effect_outcome.warnings || outcome.warnings;

  IF NOT restored.assignment_active THEN
    outcome.changes := outcome.changes || supersede_submission_proposal(
      p_target.class_id, task_key, student_key, p_op_id, p_time
    );
  END IF;
  RETURN outcome;
END;
$$;
