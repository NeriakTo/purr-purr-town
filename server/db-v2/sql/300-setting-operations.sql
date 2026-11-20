CREATE FUNCTION ppt.valid_agent_limits(p_value jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT has_only_keys(p_value, ARRAY[
    'max_students_per_call', 'max_students_per_10min', 'max_points_per_tx',
    'max_points_per_student_per_day', 'max_pending_held'
  ])
    AND is_bounded_integer(p_value->'max_students_per_call', 1, 100000)
    AND is_bounded_integer(p_value->'max_students_per_10min', 1, 100000)
    AND is_bounded_integer(p_value->'max_points_per_tx', 1, 100000)
    AND is_bounded_integer(p_value->'max_points_per_student_per_day', 1, 100000)
    AND is_bounded_integer(p_value->'max_pending_held', 1, 100000);
$$;

CREATE FUNCTION ppt.valid_setting_array(p_value jsonb, p_item_type text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_value) AS item(value)
    GROUP BY value
    HAVING jsonb_typeof(value) <> p_item_type OR (p_item_type = 'string' AND (value = '""'::jsonb OR count(*) > 1))
  );
END;
$$;

CREATE FUNCTION ppt.valid_semester_periods(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT is_json_object(p_value) THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_each(p_value) AS period(key, value)
    WHERE NOT is_json_object(value)
      OR (value ? 'start' AND value->'start' <> 'null'::jsonb AND NOT valid_calendar_day(value->'start'))
      OR (value ? 'end' AND value->'end' <> 'null'::jsonb AND NOT valid_calendar_day(value->'end'))
  );
END;
$$;

CREATE FUNCTION ppt.valid_setting_value(p_key text, p_value jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE p_key
    WHEN 'currency' THEN is_json_object(p_value)
      AND is_json_object(p_value->'base') AND is_json_object(p_value->'tier1') AND is_json_object(p_value->'tier2')
      AND is_bounded_integer(p_value #> '{tier1,rate}', 1, 100000)
      AND is_bounded_integer(p_value #> '{tier2,rate}', 1, 100000)
    WHEN 'agentLimits' THEN valid_agent_limits(p_value)
    WHEN 'correctionOverdueGraceDays' THEN is_bounded_integer(p_value, 0, 365)
    WHEN 'currentSemester' THEN p_value = 'null'::jsonb OR (
      jsonb_typeof(p_value) = 'string' AND (p_value #>> '{}') COLLATE "C" ~ '^[0-9]{2,3}-[12]$'
    )
    WHEN 'taskTypes' THEN valid_setting_array(p_value, 'string')
    WHEN 'ruleCategories' THEN valid_setting_array(p_value, 'object')
    WHEN 'semesterPeriods' THEN valid_semester_periods(p_value)
    WHEN 'shopMeta' THEN is_json_object(p_value)
    WHEN 'dutyJobId' THEN true
    ELSE false
  END;
$$;

CREATE FUNCTION ppt.validate_setting_set(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['key', 'value'])
      OR NOT has_nonempty_string(p_payload, 'key') OR NOT p_payload ? 'value'
      OR NOT valid_setting_value(p_payload->>'key', p_payload->'value') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF p_payload->>'key' = 'dutyJobId' THEN
    -- PPT-PENDING: setting_duty_job
    PERFORM pending_operation('setting_duty_job');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_setting_version(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  setting_key text := p_op->'payload'->>'key';
  setting settings_entries;
BEGIN
  SELECT * INTO setting FROM settings_entries WHERE class_id = p_op->>'class_id' AND key = setting_key;
  PERFORM require_version_condition(
    p_op, 'setting', jsonb_build_object('key', setting_key), setting.rev, setting.last_op_id,
    CASE WHEN setting.rev IS NOT NULL THEN jsonb_build_object('value', setting.value) END, setting.rev IS NULL
  );
END;
$$;

CREATE FUNCTION ppt.store_setting(p_class_id text, p_key text, p_value jsonb, p_op_id text)
RETURNS ppt.settings_entries
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO settings_entries AS target (class_id, key, value, last_op_id)
  VALUES (p_class_id, p_key, p_value, p_op_id)
  ON CONFLICT (class_id, key) DO UPDATE
  SET value = excluded.value, rev = target.rev + 1, last_op_id = excluded.last_op_id
  RETURNING target.*;
$$;

CREATE FUNCTION ppt.apply_setting_set(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  setting_key text := p_op->'payload'->>'key';
  new_value jsonb := p_op->'payload'->'value';
  previous settings_entries;
  target settings_entries;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM settings_entries WHERE class_id = class_key AND key = setting_key;
  unchanged := previous.value IS NOT DISTINCT FROM new_value;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_setting(class_key, setting_key, new_value, p_op->>'op_id');
  END IF;
  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'setting', jsonb_build_object('key', setting_key), coalesce(previous.rev, 0),
    target.rev, target.last_op_id,
    CASE WHEN previous.rev IS NOT NULL THEN jsonb_build_object('value', previous.value) END,
    jsonb_build_object('value', target.value)
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
