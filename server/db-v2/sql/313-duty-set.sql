CREATE FUNCTION ppt.duty_key(p_day text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('date', p_day);
$$;

CREATE FUNCTION ppt.load_daily_duty(p_class_id text, p_day date)
RETURNS ppt.daily_duties
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM daily_duties WHERE class_id = p_class_id AND duty_date = p_day;
$$;

CREATE FUNCTION ppt.duty_value(p_student_ids jsonb)
RETURNS jsonb
LANGUAGE sql STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('student_ids', p_student_ids);
$$;

CREATE FUNCTION ppt.validate_duty_set(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['date', 'student_ids'])
    OR NOT valid_calendar_day(p_payload->'date') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_task_assignee_list(p_payload->'student_ids', true);
END;
$$;

CREATE FUNCTION ppt.require_duty_set_targets(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  duty daily_duties := load_daily_duty(class_key, (payload->>'date')::date);
BEGIN
  PERFORM require_job_students(class_key, payload->'student_ids');
  PERFORM require_version_condition(p_op, 'duty', duty_key(payload->>'date'), duty.rev,
    duty.last_op_id, duty_value(duty.student_ids), duty.rev IS NULL);
END;
$$;

CREATE FUNCTION ppt.apply_duty_set(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  duty_day date := (payload->>'date')::date;
  roster jsonb := payload->'student_ids';
  previous daily_duties := load_daily_duty(class_key, duty_day);
  current_duty daily_duties := previous;
  unchanged boolean := previous.student_ids IS NOT DISTINCT FROM roster;
BEGIN
  IF NOT unchanged THEN
    INSERT INTO daily_duties AS target (class_id, duty_date, student_ids, last_op_id)
    VALUES (class_key, duty_day, roster, p_op->>'op_id')
    ON CONFLICT (class_id, duty_date) DO UPDATE
    SET student_ids = excluded.student_ids, rev = target.rev + 1, last_op_id = excluded.last_op_id
    RETURNING target.* INTO current_duty;
  END IF;

  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'duty', duty_key(payload->>'date'), coalesce(previous.rev, 0), current_duty.rev, current_duty.last_op_id,
    duty_value(previous.student_ids), duty_value(current_duty.student_ids)
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
