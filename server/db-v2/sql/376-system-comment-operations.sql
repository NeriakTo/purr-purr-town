CREATE FUNCTION ppt.validate_generated_comment(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  fields jsonb := p_payload - ARRAY['request_op_id', 'student_id', 'semester'];
  valid boolean;
BEGIN
  IF NOT coalesce(valid_comment_target(p_payload), false)
    OR NOT has_nonempty_string(p_payload, 'request_op_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  IF fields ? 'error' THEN
    valid := has_only_keys(fields, ARRAY['error']) AND class_bounded_text(fields->'error', 1, 500);
  ELSE
    valid := has_only_keys(fields, ARRAY['comment', 'motto', 'analysis', 'model'])
      AND class_bounded_text(fields->'comment', 0, 2000)
      AND class_bounded_text(fields->'motto', 0, 200)
      AND class_bounded_text(fields->'analysis', 0, 5000)
      AND class_bounded_text(fields->'model', 1, 100);
  END IF;
  IF NOT coalesce(valid, false) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_generated_comment(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
BEGIN
  PERFORM validate_generated_comment(payload);

  IF NOT EXISTS (
    SELECT 1 FROM operations
    WHERE class_id = p_op->>'class_id' AND op_id = p_op->'payload'->>'request_op_id'
      AND type = 'comment.request_generation' AND status = 'committed'
      AND comment_key(operations.payload) = comment_key(p_op->'payload')
  ) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
END;
$$;

CREATE FUNCTION ppt.unlocked_generated_comment_fields(p_previous ppt.comments, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each(p_payload)
  WHERE (key = 'comment' AND p_previous.locked_comment = 'false'::jsonb)
    OR (key = 'motto' AND p_previous.locked_motto = 'false'::jsonb);
$$;

CREATE FUNCTION ppt.superseded_generated_comment_fields(p_previous ppt.comments, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  fields jsonb := '{}'::jsonb;
BEGIN
  IF NOT p_payload ? 'error' THEN
    fields := jsonb_build_object('suggestion', p_payload - ARRAY['student_id', 'semester']);
  END IF;
  IF p_previous.generation_status = 'generating' THEN
    fields := fields || '{"generation_status": "idle"}'::jsonb;
  END IF;
  RETURN fields;
END;
$$;

CREATE FUNCTION ppt.apply_generated_comment(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  previous comments := find_comment(p_op);
  target comments := previous;
  superseded boolean := previous.rev IS DISTINCT FROM operation_entity_revision(
    p_op->>'class_id', payload->>'request_op_id', 'comment', comment_key(payload)
  );
  written jsonb := '{}'::jsonb;
  fields jsonb;
  changed jsonb;
BEGIN
  IF superseded THEN
    fields := superseded_generated_comment_fields(previous, payload);
  ELSIF payload ? 'error' THEN
    fields := jsonb_build_object('generation_status', 'failed', 'generation_error', payload->'error');
  ELSE
    written := unlocked_generated_comment_fields(previous, payload);
    fields := written || jsonb_build_object(
      'analysis', payload->'analysis', 'model', payload->'model', 'generation_status', 'idle', 'generation_error', NULL
    );
  END IF;

  changed := comment_changed_fields(comment_value(previous), fields);
  IF NOT superseded OR changed <> '{}'::jsonb THEN
    target := store_comment_change(p_op, previous, fields);
  END IF;
  RETURN comment_operation_outcome(previous, target, changed, jsonb_build_object(
    'superseded', superseded,
    'written', ARRAY(SELECT field FROM jsonb_object_keys(written) AS field ORDER BY field COLLATE "C")
  ));
END;
$$;
