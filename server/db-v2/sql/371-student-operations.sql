CREATE FUNCTION ppt.student_value(p_student ppt.students)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'name', p_student.name, 'seat_number', p_student.seat_number, 'avatar', p_student.avatar,
    'group_key', p_student.group_key, 'enrollment_status', p_student.enrollment_status,
    'exempt_rules', p_student.exempt_rules
  );
$$;

CREATE FUNCTION ppt.require_student(p_class_id text, p_student_id text)
RETURNS ppt.students
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  student students;
BEGIN
  SELECT * INTO student FROM students WHERE class_id = p_class_id AND student_id = p_student_id;
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  RETURN student;
END;
$$;

CREATE FUNCTION ppt.student_seat_in_use(p_class_id text, p_seat integer, p_student_id text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM students
    WHERE class_id = p_class_id AND seat_number = p_seat AND student_id <> p_student_id
      AND enrollment_status IN ('enrolled', 'home_study')
  );
$$;

CREATE FUNCTION ppt.check_student_add(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  student_key text := payload->>'student_id';
BEGIN
  IF NOT has_only_keys(payload, ARRAY['student_id', 'seat_number', 'name', 'group_key'])
    OR NOT has_nonempty_string(payload, 'student_id')
    OR NOT is_bounded_integer(payload->'seat_number', 1, 999)
    OR NOT class_bounded_text(payload->'name', 1, 100)
    OR (payload ? 'group_key' AND payload->'group_key' <> 'null'::jsonb
      AND NOT class_bounded_text(payload->'group_key', 1, 50)) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  IF EXISTS (SELECT 1 FROM students WHERE class_id = class_key AND student_id = student_key) THEN
    PERFORM reject_operation('ID_CONFLICT');
  END IF;

  IF NOT valid_v4_op_id(student_key)
    OR student_seat_in_use(class_key, (payload->'seat_number')::integer, student_key) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.create_student_with_account(
  p_class_id text, p_student_id text, p_seat_number integer, p_name text, p_group_key text, p_op_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  student students;
  account accounts;
  entity_key jsonb := jsonb_build_object('student_id', p_student_id);
BEGIN
  INSERT INTO students (class_id, student_id, seat_number, name, group_key, last_op_id)
  VALUES (p_class_id, p_student_id, p_seat_number, p_name, p_group_key, p_op_id) RETURNING * INTO student;

  INSERT INTO accounts (class_id, student_id, last_op_id)
  VALUES (p_class_id, p_student_id, p_op_id) RETURNING * INTO account;

  RETURN jsonb_build_array(
    entity_change('student', entity_key, 0, student.rev, p_op_id, NULL, student_value(student)),
    entity_change('account', entity_key, 0, account.rev, p_op_id, NULL,
      jsonb_build_object('balance', account.balance, 'total_earned', account.total_earned))
  );
END;
$$;

CREATE FUNCTION ppt.apply_student_add(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT (operation_result(), create_student_with_account(
    p_op->>'class_id', p_op->'payload'->>'student_id', (p_op->'payload'->'seat_number')::integer,
    p_op->'payload'->>'name', p_op->'payload'->>'group_key', p_op->>'op_id'
  ), '[]'::jsonb)::operation_outcome;
$$;

CREATE FUNCTION ppt.valid_student_exempt_rules(p_rules jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(p_rules) = 'array' THEN
    jsonb_array_length(p_rules) <= 50 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rules) AS item(value)
      WHERE NOT has_only_keys(value, ARRAY['keyword', 'taskType'])
        OR NOT class_bounded_text(value->'keyword', 1, 50)
        OR NOT class_bounded_text(value->'taskType', 1, 50)
    )
  ELSE false END;
$$;

CREATE FUNCTION ppt.valid_student_profile(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT has_only_keys(p_payload, ARRAY['student_id', 'name', 'seat_number', 'avatar'])
    AND p_payload ?| ARRAY['name', 'seat_number', 'avatar']
    AND (NOT p_payload ? 'name' OR class_bounded_text(p_payload->'name', 1, 100))
    AND (NOT p_payload ? 'seat_number' OR is_bounded_integer(p_payload->'seat_number', 1, 999))
    AND (NOT p_payload ? 'avatar' OR p_payload->'avatar' = 'null'::jsonb
      OR class_bounded_text(p_payload->'avatar', 0, 200));
$$;

CREATE FUNCTION ppt.validate_student_change(p_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_nonempty_string(p_payload, 'student_id') OR NOT coalesce(CASE p_type
    WHEN 'student.update_profile' THEN valid_student_profile(p_payload)
    WHEN 'student.set_enrollment' THEN has_only_keys(p_payload, ARRAY['student_id', 'enrollment_status'])
      AND p_payload->'enrollment_status' IN (
        '"enrolled"'::jsonb, '"home_study"'::jsonb, '"transferred"'::jsonb, '"archived"'::jsonb
      )
    WHEN 'student.set_exempt_rules' THEN has_only_keys(p_payload, ARRAY['student_id', 'rules'])
      AND valid_student_exempt_rules(p_payload->'rules')
  END, false) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_student_change(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  previous students;
  new_seat integer;
BEGIN
  PERFORM validate_student_change(p_op->>'type', payload);
  previous := require_student(p_op->>'class_id', payload->>'student_id');

  IF previous.enrollment_status IN ('transferred', 'archived')
    AND payload->>'enrollment_status' IN ('enrolled', 'home_study')
    AND student_seat_in_use(previous.class_id, previous.seat_number, previous.student_id) THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;

  PERFORM require_version_condition(
    p_op, 'student', jsonb_build_object('student_id', previous.student_id),
    previous.rev, previous.last_op_id, student_value(previous)
  );

  new_seat := (payload->'seat_number')::integer;
  IF new_seat IS NOT NULL AND new_seat IS DISTINCT FROM previous.seat_number
    AND previous.enrollment_status IN ('enrolled', 'home_study')
    AND student_seat_in_use(previous.class_id, new_seat, previous.student_id) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_student_change(p_previous ppt.students, p_fields jsonb, p_op_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  old_fields jsonb;
  target students := p_previous;
BEGIN
  SELECT jsonb_object_agg(key, value) INTO old_fields
  FROM jsonb_each(student_value(p_previous))
  WHERE p_fields ? key;

  IF old_fields IS DISTINCT FROM p_fields THEN
    -- jsonb_populate_record 會以文字轉換整數欄位，先將 2.0 這類值正規化。
    IF p_fields ? 'seat_number' THEN
      p_fields := p_fields || jsonb_build_object('seat_number', (p_fields->'seat_number')::integer);
    END IF;
    target := jsonb_populate_record(p_previous, p_fields);
    UPDATE students
    SET name = target.name, seat_number = target.seat_number, avatar = target.avatar,
      group_key = target.group_key, enrollment_status = target.enrollment_status,
      exempt_rules = target.exempt_rules, rev = rev + 1, last_op_id = p_op_id
    WHERE class_id = p_previous.class_id AND student_id = p_previous.student_id
    RETURNING * INTO STRICT target;
  END IF;

  RETURN entity_change(
    'student', jsonb_build_object('student_id', p_previous.student_id), p_previous.rev, target.rev,
    target.last_op_id, old_fields, p_fields
  );
END;
$$;

CREATE FUNCTION ppt.apply_student_change(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  previous students := require_student(p_op->>'class_id', payload->>'student_id');
  new_fields jsonb;
  change jsonb;
BEGIN
  new_fields := CASE p_op->>'type'
    WHEN 'student.set_exempt_rules' THEN jsonb_build_object('exempt_rules', payload->'rules')
    ELSE payload - 'student_id'
  END;
  change := store_student_change(previous, new_fields, p_op->>'op_id');
  RETURN (
    operation_result(p_noop => change->'prev_rev' = change->'rev'), jsonb_build_array(change), '[]'::jsonb
  )::operation_outcome;
END;
$$;
