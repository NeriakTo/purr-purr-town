CREATE FUNCTION ppt.announcement_value(p_row ppt.announcements)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_row.rev IS NOT NULL THEN jsonb_build_object(
    'text', p_row.text, 'color', p_row.color, 'rotation', p_row.rotation, 'removed', p_row.removed
  ) END;
$$;

CREATE FUNCTION ppt.validate_announcement_payload(p_payload jsonb, p_remove boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  angle jsonb := p_payload->'rotation';
BEGIN
  IF NOT has_nonempty_string(p_payload, 'announcement_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF p_remove THEN
    IF NOT has_only_keys(p_payload, ARRAY['announcement_id']) THEN
      PERFORM reject_operation('INVALID_PAYLOAD');
    END IF;
    RETURN;
  END IF;

  IF NOT has_only_keys(p_payload, ARRAY['announcement_id', 'text', 'color', 'rotation'])
    OR NOT class_bounded_text(p_payload->'text', 1, 500)
    OR (p_payload ? 'color' AND p_payload->'color' <> 'null'::jsonb
      AND NOT class_bounded_text(p_payload->'color', 0, 30))
    OR (angle IS NOT NULL AND angle <> 'null'::jsonb AND CASE
      WHEN jsonb_typeof(angle) = 'number' THEN (angle::numeric) NOT BETWEEN -360 AND 360
      ELSE true
    END) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_announcement_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  announcement_key text := payload->>'announcement_id';
  removing boolean := p_op->>'type' = 'announcement.remove';
  previous announcements;
BEGIN
  PERFORM validate_announcement_payload(payload, removing);
  SELECT * INTO previous FROM announcements
  WHERE class_id = p_op->>'class_id' AND announcement_id = announcement_key;

  IF removing AND previous.rev IS NULL THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  PERFORM require_version_condition(
    p_op, 'announcement', jsonb_build_object('announcement_id', announcement_key),
    previous.rev, previous.last_op_id, announcement_value(previous), previous.rev IS NULL
  );
  IF previous.rev IS NULL AND NOT valid_v4_op_id(announcement_key) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_announcement_change(
  p_class_id text, p_announcement_id text, p_op_id text, p_value jsonb, p_previous_rev integer
)
RETURNS ppt.announcements
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target announcements;
BEGIN
  IF p_previous_rev IS NULL THEN
    INSERT INTO announcements (class_id, announcement_id, text, color, rotation, last_op_id)
    VALUES (p_class_id, p_announcement_id, p_value->>'text', p_value->>'color',
      (p_value->>'rotation')::numeric, p_op_id)
    RETURNING * INTO STRICT target;
  ELSE
    UPDATE announcements
    SET text = p_value->>'text', color = p_value->>'color', rotation = (p_value->>'rotation')::numeric,
      removed = (p_value->>'removed')::boolean, rev = rev + 1, last_op_id = p_op_id
    WHERE class_id = p_class_id AND announcement_id = p_announcement_id
    RETURNING * INTO STRICT target;
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.apply_announcement_operation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  class_key text := p_op->>'class_id';
  announcement_key text := payload->>'announcement_id';
  removing boolean := p_op->>'type' = 'announcement.remove';
  previous announcements;
  target announcements;
  previous_value jsonb;
  next_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM announcements WHERE class_id = class_key AND announcement_id = announcement_key;
  previous_value := announcement_value(previous);
  IF removing THEN
    next_value := previous_value || '{"removed": true}'::jsonb;
  ELSE
    next_value := jsonb_build_object(
      'text', payload->'text', 'color', payload->'color', 'rotation', payload->'rotation', 'removed', false
    );
  END IF;

  unchanged := previous_value IS NOT DISTINCT FROM next_value;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_announcement_change(class_key, announcement_key, p_op->>'op_id', next_value, previous.rev);
  END IF;
  IF removing THEN
    previous_value := jsonb_build_object('removed', previous.removed);
    next_value := '{"removed": true}'::jsonb;
  END IF;

  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'announcement', jsonb_build_object('announcement_id', announcement_key), coalesce(previous.rev, 0),
    target.rev, target.last_op_id, previous_value, next_value
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
