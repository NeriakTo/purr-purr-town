CREATE FUNCTION ppt.valid_correction_round_date(p_value jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_value IS NULL OR p_value = 'null'::jsonb OR valid_calendar_day(p_value);
$$;

CREATE FUNCTION ppt.require_unused_correction_round_id(p_class_id text, p_correction_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF (load_correction_round(p_class_id, p_correction_id)).correction_id IS NOT NULL THEN
    PERFORM reject_operation('ID_CONFLICT');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_correction_round_creation(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  task_key text := payload->>'task_id';
  student_key text := payload->>'student_id';
BEGIN
  IF NOT has_only_keys(payload, ARRAY['correction_id', 'task_id', 'student_id', 'due_on', 'note'])
    OR NOT valid_v4_op_id(payload->>'correction_id')
    OR NOT has_nonempty_string(payload, 'task_id')
    OR NOT has_nonempty_string(payload, 'student_id')
    OR NOT valid_correction_round_date(payload->'due_on')
    OR (payload ? 'note' AND jsonb_typeof(payload->'note') NOT IN ('string', 'null'))
    OR length(payload->>'note') > 100 THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  PERFORM require_submission_targets(class_key, task_key, student_key, p_actor);
  IF (open_correction_round(class_key, task_key, student_key)).correction_id IS NOT NULL THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
  PERFORM require_unused_correction_round_id(class_key, payload->>'correction_id');
END;
$$;

CREATE FUNCTION ppt.require_correction_round(p_op jsonb, p_actor jsonb)
RETURNS ppt.corrections
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target corrections := load_correction_round(p_op->>'class_id', p_op->'payload'->>'correction_id');
BEGIN
  IF target.correction_id IS NULL THEN
    IF p_actor->>'kind' = 'agent' THEN
      PERFORM reject_operation('SCOPE_FORBIDDEN');
    END IF;
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.require_correction_round_version(p_op jsonb, p_actor jsonb, p_row ppt.corrections)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_actor->>'kind' <> 'agent' THEN
    PERFORM require_version_condition(
      p_op, 'correction', correction_round_key(p_row), p_row.rev, p_row.last_op_id, correction_round_value(p_row)
    );
  ELSIF NOT matches_version_condition(
    p_row.class_id, p_op->'expect', 'correction', correction_round_key(p_row), p_row.rev, false
  ) THEN
    PERFORM reject_operation('STALE_STATE', current_entity_revision(
      p_row.class_id, p_row.last_op_id, p_row.rev, correction_round_value(p_row)
    ) #- '{actor,id}');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_correction_round_return(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  target corrections;
BEGIN
  IF NOT has_only_keys(payload, ARRAY['correction_id']) OR NOT has_nonempty_string(payload, 'correction_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  target := require_correction_round(p_op, p_actor);
  IF target.status <> 'required' THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
  PERFORM require_correction_round_version(p_op, p_actor, target);
END;
$$;
