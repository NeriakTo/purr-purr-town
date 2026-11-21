CREATE FUNCTION ppt.seating_value(p_row ppt.seating)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_row.rev IS NOT NULL THEN to_jsonb(p_row) - ARRAY['class_id', 'rev', 'last_op_id'] END;
$$;

CREATE FUNCTION ppt.validate_seating_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['rows', 'cols', 'view', 'seats', 'objects', 'custom_objects'])
    OR NOT is_bounded_integer(p_payload->'rows', 1, 50)
    OR NOT is_bounded_integer(p_payload->'cols', 1, 50)
    OR NOT class_bounded_text(p_payload->'view', 1, 20)
    OR NOT is_json_object(p_payload->'seats') OR NOT is_json_object(p_payload->'objects')
    OR jsonb_typeof(p_payload->'custom_objects') IS DISTINCT FROM 'array' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_payload->'seats')
    WHERE jsonb_typeof(value) <> 'string' OR value #>> '{}' = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'seats') GROUP BY value HAVING count(*) > 1
  ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_seating_save(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  previous seating;
BEGIN
  PERFORM validate_seating_payload(payload);
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(payload->'seats') AS seat
    LEFT JOIN students AS s ON s.class_id = class_key AND s.student_id = seat.value
    WHERE s.student_id IS NULL
  ) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;

  SELECT * INTO previous FROM seating WHERE class_id = class_key;
  PERFORM require_version_condition(
    p_op, 'seating', jsonb_build_object('class_id', class_key), previous.rev,
    previous.last_op_id, seating_value(previous), previous.rev IS NULL
  );
END;
$$;

CREATE FUNCTION ppt.store_seating_save(p_class_id text, p_op_id text, p_payload jsonb, p_previous_rev integer)
RETURNS ppt.seating
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target seating := jsonb_populate_record(NULL::seating, p_payload - ARRAY['rows', 'cols']);
BEGIN
  target.rows := (p_payload->'rows')::integer;
  target.cols := (p_payload->'cols')::integer;

  IF p_previous_rev IS NULL THEN
    INSERT INTO seating (class_id, rows, cols, view, seats, objects, custom_objects, last_op_id)
    VALUES (p_class_id, target.rows, target.cols, target.view, target.seats, target.objects,
      target.custom_objects, p_op_id)
    RETURNING * INTO STRICT target;
  ELSE
    UPDATE seating
    SET rows = target.rows, cols = target.cols, view = target.view, seats = target.seats,
      objects = target.objects, custom_objects = target.custom_objects, rev = rev + 1, last_op_id = p_op_id
    WHERE class_id = p_class_id
    RETURNING * INTO STRICT target;
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.apply_seating_save(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  previous seating;
  target seating;
  previous_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM seating WHERE class_id = class_key;
  previous_value := seating_value(previous);
  unchanged := previous_value IS NOT DISTINCT FROM payload;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_seating_save(class_key, p_op->>'op_id', payload, previous.rev);
  END IF;

  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'seating', jsonb_build_object('class_id', class_key), coalesce(previous.rev, 0), target.rev,
    target.last_op_id, previous_value, seating_value(target)
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
