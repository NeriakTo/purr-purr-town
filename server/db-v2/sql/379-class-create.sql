CREATE FUNCTION ppt.check_class_create(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  ids jsonb := payload->'student_ids';
  source_key jsonb := payload->'inherit_from_class_id';
BEGIN
  IF NOT has_only_keys(payload, ARRAY[
    'class_id', 'school_year', 'name', 'teacher_name', 'alias', 'student_count', 'student_ids', 'inherit_from_class_id'
  ]) OR payload->'class_id' IS DISTINCT FROM p_op->'class_id'
    OR NOT valid_class_info_fields(payload)
    OR NOT is_bounded_integer(payload->'student_count', 0, 100)
    OR jsonb_typeof(ids) IS DISTINCT FROM 'array'
    OR (source_key IS NOT NULL AND source_key <> 'null'::jsonb
      AND NOT has_nonempty_string(payload, 'inherit_from_class_id')) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF jsonb_array_length(ids) <> (payload->'student_count')::integer
    OR EXISTS (
      SELECT FROM jsonb_array_elements(ids) AS student(id)
      WHERE jsonb_typeof(id) <> 'string' OR NOT valid_v4_op_id(id #>> '{}')
    ) OR EXISTS (
      SELECT FROM jsonb_array_elements(ids) AS student(id) GROUP BY id HAVING count(*) > 1
    ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF EXISTS (SELECT FROM classes WHERE class_id = p_op->>'class_id') THEN
    PERFORM reject_operation('ID_CONFLICT');
  END IF;
  IF NOT valid_v4_op_id(p_op->>'class_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.create_class_students(p_class_id text, p_op_id text, p_ids jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
  pair jsonb;
  student_changes jsonb := '[]';
  account_changes jsonb := '[]';
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements_text(p_ids) WITH ORDINALITY AS student(id, seat)
    ORDER BY seat
  LOOP
    pair := create_student_with_account(p_class_id, item.id, item.seat::integer, item.seat || '號村民', NULL, p_op_id);
    student_changes := student_changes || jsonb_build_array(pair->0);
    account_changes := account_changes || jsonb_build_array(pair->1);
  END LOOP;
  RETURN student_changes || account_changes;
END;
$$;

CREATE FUNCTION ppt.apply_class_create(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  op_key text := p_op->>'op_id';
  source_key text := payload->>'inherit_from_class_id';
  target classes;
  changes jsonb;
BEGIN
  INSERT INTO classes (class_id, school_year, name, teacher, alias, last_op_id)
  VALUES (class_key, payload->>'school_year', payload->>'name', payload->>'teacher_name', payload->>'alias', op_key)
  RETURNING * INTO STRICT target;
  INSERT INTO class_ownership (class_id, teacher_id) VALUES (class_key, p_actor->>'id');
  INSERT INTO class_authorizations (class_id, actor_kind) VALUES (class_key, 'scheduler');

  changes := jsonb_build_array(entity_change('class', jsonb_build_object('class_id', class_key), 0,
    target.rev, op_key, NULL, class_info_value(target)
      || jsonb_build_object('status', target.status, 'cutover_date', target.cutover_date)));
  changes := changes || create_class_students(class_key, op_key, payload->'student_ids');

  IF source_key IS NULL THEN
    PERFORM store_class_defaults(class_key, op_key, p_time);
  ELSE
    PERFORM store_class_inheritance(class_key, source_key, op_key, p_time);
  END IF;
  changes := changes || class_create_resource_changes(class_key, op_key);
  RETURN (operation_result() || jsonb_build_object('class', jsonb_build_object(
    'class_id', class_key, 'student_count', payload->'student_count', 'inherited_from', source_key
  )), changes, '[]'::jsonb)::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.submit_class_create(p_op jsonb, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  op_key text := CASE WHEN jsonb_typeof(p_op->'op_id') = 'string' THEN p_op->>'op_id' END;
  payload jsonb := p_op->'payload';
BEGIN
  IF NOT valid_v4_op_id(op_key) THEN
    RETURN retry_receipt(op_key, 'INVALID_OP_ID');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ppt.class.create:' || class_key, 0));
  PERFORM class_id FROM classes WHERE class_id = class_key FOR UPDATE;
  IF FOUND THEN
    IF NOT can_access_class(class_key, p_actor) THEN
      RETURN retry_receipt(op_key, 'CLASS_FORBIDDEN');
    END IF;
  ELSIF has_nonempty_string(payload, 'inherit_from_class_id')
    AND NOT lock_class_inherit_source(payload->>'inherit_from_class_id', p_actor) THEN
    RETURN retry_receipt(op_key, 'CLASS_FORBIDDEN');
  END IF;

  -- The transaction lock serves as the target lock until the new row exists.
  RETURN submit_locked_operation(p_op, p_actor);
END;
$$;
