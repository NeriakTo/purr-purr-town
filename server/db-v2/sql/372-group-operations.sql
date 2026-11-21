CREATE FUNCTION ppt.validate_group_assign_items(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  items jsonb := p_payload->'items';
  item jsonb;
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['items'])
    OR jsonb_typeof(items) IS DISTINCT FROM 'array' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  IF jsonb_array_length(items) NOT BETWEEN 1 AND 200 THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF NOT has_only_keys(item, ARRAY['student_id', 'group_key', 'expect'])
      OR NOT has_nonempty_string(item, 'student_id')
      OR NOT class_bounded_text(item->'group_key', 1, 50) THEN
      PERFORM reject_operation('INVALID_PAYLOAD');
    END IF;
    PERFORM validate_version_condition(item->'expect');
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(items) AS entry(value) GROUP BY value->>'student_id' HAVING count(*) > 1
  ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.group_assignment_stale_item(p_class_id text, p_item jsonb, p_student ppt.students)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  key jsonb := jsonb_build_object('student_id', p_student.student_id);
  rejection_code text;
  current_detail text;
BEGIN
  PERFORM require_version_condition(
    jsonb_build_object('class_id', p_class_id, 'expect', p_item->'expect'),
    'student', key, p_student.rev, p_student.last_op_id, jsonb_build_object('group_key', p_student.group_key)
  );
  RETURN NULL;
EXCEPTION WHEN SQLSTATE 'P604R' THEN
  GET STACKED DIAGNOSTICS rejection_code = MESSAGE_TEXT, current_detail = PG_EXCEPTION_DETAIL;
  IF rejection_code <> 'STALE_STATE' THEN
    RAISE;
  END IF;
  RETURN key || current_detail::jsonb;
END;
$$;

CREATE FUNCTION ppt.check_group_assignment(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  item jsonb;
  student students;
  stale_item jsonb;
  stale_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM validate_group_assign_items(payload);

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'items') AS entry(value)
    LEFT JOIN students AS s ON s.class_id = class_key AND s.student_id = value->>'student_id'
    WHERE s.student_id IS NULL
  ) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(payload->'items') LOOP
    student := require_student(class_key, item->>'student_id');
    stale_item := group_assignment_stale_item(class_key, item, student);
    IF stale_item IS NOT NULL THEN
      stale_items := stale_items || jsonb_build_array(stale_item);
    END IF;
  END LOOP;

  IF stale_items <> '[]'::jsonb THEN
    PERFORM reject_operation('STALE_STATE', jsonb_build_object('items', stale_items));
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_group_assignment(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  item jsonb;
  student students;
  change jsonb;
  changes jsonb := '[]'::jsonb;
  unchanged boolean := true;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_op->'payload'->'items') LOOP
    student := require_student(class_key, item->>'student_id');
    change := store_student_change(
      student, jsonb_build_object('group_key', nullif(item->>'group_key', 'unassigned')), p_op->>'op_id'
    );
    changes := changes || jsonb_build_array(change);
    unchanged := unchanged AND change->'prev_rev' = change->'rev';
  END LOOP;

  RETURN (operation_result(p_noop => unchanged), changes, '[]'::jsonb)::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.group_value(p_group ppt.groups)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_group.rev IS NOT NULL THEN
    jsonb_build_object('name', p_group.name, 'leader_student_id', p_group.leader_student_id)
  END;
$$;

CREATE FUNCTION ppt.check_group_save(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  group_id text := payload->>'group_key';
  leader text := payload->>'leader_student_id';
  previous groups;
BEGIN
  IF NOT has_only_keys(payload, ARRAY['group_key', 'name', 'leader_student_id'])
    OR NOT class_bounded_text(payload->'group_key', 1, 50) OR group_id = 'unassigned'
    OR NOT class_bounded_text(payload->'name', 1, 100)
    OR (payload ? 'leader_student_id' AND payload->'leader_student_id' <> 'null'::jsonb
      AND NOT has_nonempty_string(payload, 'leader_student_id')) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  IF leader IS NOT NULL THEN
    PERFORM require_student(class_key, leader);
  END IF;

  SELECT * INTO previous FROM groups WHERE class_id = class_key AND group_key = group_id;
  PERFORM require_version_condition(
    p_op, 'group', jsonb_build_object('group_key', group_id), previous.rev, previous.last_op_id,
    group_value(previous), previous.rev IS NULL
  );
END;
$$;

CREATE FUNCTION ppt.store_group_save(
  p_class_id text, p_group_key text, p_name text, p_leader text, p_op_id text, p_previous_rev integer
)
RETURNS ppt.groups
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target groups;
BEGIN
  IF p_previous_rev IS NULL THEN
    INSERT INTO groups (class_id, group_key, name, leader_student_id, last_op_id)
    VALUES (p_class_id, p_group_key, p_name, p_leader, p_op_id) RETURNING * INTO STRICT target;
  ELSE
    UPDATE groups SET name = p_name, leader_student_id = p_leader, rev = rev + 1, last_op_id = p_op_id
    WHERE class_id = p_class_id AND group_key = p_group_key RETURNING * INTO STRICT target;
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.apply_group_save(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  group_id text := payload->>'group_key';
  previous groups;
  target groups;
  leader text;
  previous_value jsonb;
  next_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM groups WHERE class_id = class_key AND group_key = group_id;
  leader := CASE WHEN payload ? 'leader_student_id' THEN payload->>'leader_student_id'
    ELSE previous.leader_student_id END;
  unchanged := previous.name IS NOT DISTINCT FROM payload->>'name'
    AND previous.leader_student_id IS NOT DISTINCT FROM leader;

  IF unchanged THEN
    target := previous;
  ELSE
    target := store_group_save(class_key, group_id, payload->>'name', leader, p_op->>'op_id', previous.rev);
  END IF;

  previous_value := group_value(previous);
  next_value := group_value(target);
  IF previous.rev IS NOT NULL AND NOT payload ? 'leader_student_id' THEN
    previous_value := previous_value - 'leader_student_id';
    next_value := next_value - 'leader_student_id';
  END IF;
  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'group', jsonb_build_object('group_key', group_id), coalesce(previous.rev, 0), target.rev,
    target.last_op_id, previous_value, next_value
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
