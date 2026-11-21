CREATE FUNCTION ppt.class_bounded_text(p_value jsonb, p_min integer, p_max integer)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_typeof(p_value) IS NOT DISTINCT FROM 'string'
    AND char_length(p_value #>> '{}') BETWEEN p_min AND p_max;
$$;

CREATE FUNCTION ppt.class_info_value(p_class ppt.classes)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'name', p_class.name, 'alias', p_class.alias,
    'teacher_name', p_class.teacher, 'school_year', p_class.school_year
  );
$$;

CREATE FUNCTION ppt.valid_class_info_fields(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT class_bounded_text(p_payload->'name', 1, 100)
    AND class_bounded_text(p_payload->'alias', 0, 100)
    AND class_bounded_text(p_payload->'teacher_name', 0, 100)
    AND class_bounded_text(p_payload->'school_year', 1, 20);
$$;

CREATE FUNCTION ppt.check_class_change(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  previous classes;
BEGIN
  IF p_op->>'type' = 'class.update_info' THEN
    IF NOT has_only_keys(payload, ARRAY['name', 'alias', 'teacher_name', 'school_year'])
      OR NOT valid_class_info_fields(payload) THEN
      PERFORM reject_operation('INVALID_PAYLOAD');
    END IF;
  ELSIF NOT has_only_keys(payload, ARRAY['status'])
    OR NOT coalesce(payload->'status' IN ('"active"'::jsonb, '"archived"'::jsonb), false) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  SELECT * INTO STRICT previous FROM classes WHERE class_id = class_key;
  PERFORM require_version_condition(
    p_op, 'class', jsonb_build_object('class_id', class_key), previous.rev, previous.last_op_id,
    class_info_value(previous) || jsonb_build_object('status', previous.status)
  );
END;
$$;

CREATE FUNCTION ppt.store_class_change(p_previous ppt.classes, p_op jsonb)
RETURNS ppt.classes
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  target classes;
BEGIN
  IF p_op->>'type' = 'class.update_info' THEN
    UPDATE classes
    SET name = payload->>'name', alias = payload->>'alias', teacher = payload->>'teacher_name',
      school_year = payload->>'school_year', rev = rev + 1, last_op_id = p_op->>'op_id'
    WHERE class_id = p_previous.class_id
    RETURNING * INTO STRICT target;
  ELSE
    UPDATE classes
    SET status = payload->>'status', rev = rev + 1, last_op_id = p_op->>'op_id'
    WHERE class_id = p_previous.class_id
    RETURNING * INTO STRICT target;
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.apply_class_change(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous classes;
  target classes;
  previous_value jsonb;
  new_value jsonb := p_op->'payload';
  unchanged boolean;
BEGIN
  SELECT * INTO STRICT previous FROM classes WHERE class_id = p_op->>'class_id';
  previous_value := CASE p_op->>'type'
    WHEN 'class.update_info' THEN class_info_value(previous)
    ELSE jsonb_build_object('status', previous.status)
  END;
  unchanged := previous_value = new_value;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_class_change(previous, p_op);
  END IF;

  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'class', jsonb_build_object('class_id', previous.class_id), previous.rev, target.rev,
    target.last_op_id, previous_value, new_value
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
