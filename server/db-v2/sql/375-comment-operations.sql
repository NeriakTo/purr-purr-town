CREATE FUNCTION ppt.comment_key(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('student_id', p_payload->'student_id', 'semester', p_payload->'semester');
$$;

CREATE FUNCTION ppt.comment_value(p_row ppt.comments)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_row.rev IS NOT NULL THEN jsonb_build_object(
    'observation', p_row.observation, 'comment', p_row.comment, 'motto', p_row.motto,
    'comment_locked', p_row.locked_comment, 'motto_locked', p_row.locked_motto,
    'generation_status', p_row.generation_status, 'generation_error', p_row.generation_error,
    'analysis', p_row.analysis, 'model', p_row.model, 'suggestion', p_row.suggestion
  ) END;
$$;

CREATE FUNCTION ppt.find_comment(p_op jsonb)
RETURNS ppt.comments
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM comments
  WHERE class_id = p_op->>'class_id' AND student_id = p_op->'payload'->>'student_id'
    AND semester = p_op->'payload'->>'semester';
$$;

CREATE FUNCTION ppt.valid_comment_target(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT has_nonempty_string(p_payload, 'student_id')
    AND jsonb_typeof(p_payload->'semester') IS NOT DISTINCT FROM 'string'
    AND (p_payload->>'semester') COLLATE "C" ~ '^[0-9]{2,3}-[12]$';
$$;

CREATE FUNCTION ppt.validate_teacher_comment_fields(p_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  fields jsonb := p_payload - ARRAY['student_id', 'semester'];
  valid boolean;
BEGIN
  valid := CASE p_type
    WHEN 'comment.save' THEN
      has_only_keys(fields, ARRAY['observation', 'comment', 'motto'])
      AND fields <> '{}'::jsonb
      AND (NOT fields ? 'observation' OR class_bounded_text(fields->'observation', 0, 5000))
      AND (NOT fields ? 'comment' OR class_bounded_text(fields->'comment', 0, 2000))
      AND (NOT fields ? 'motto' OR class_bounded_text(fields->'motto', 0, 200))
    WHEN 'comment.set_lock' THEN
      has_only_keys(fields, ARRAY['comment_locked', 'motto_locked'])
      AND jsonb_typeof(fields->'comment_locked') IS NOT DISTINCT FROM 'boolean'
      AND jsonb_typeof(fields->'motto_locked') IS NOT DISTINCT FROM 'boolean'
    WHEN 'comment.request_generation' THEN fields = '{}'::jsonb
  END;

  IF NOT coalesce(valid, false) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_teacher_comment_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  operation_type text := p_op->>'type';
  previous comments;
BEGIN
  IF NOT coalesce(valid_comment_target(payload), false) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_teacher_comment_fields(operation_type, payload);
  PERFORM require_student(p_op->>'class_id', payload->>'student_id');

  previous := find_comment(p_op);
  PERFORM require_version_condition(
    p_op, 'comment', comment_key(payload), previous.rev, previous.last_op_id,
    comment_value(previous) - ARRAY['generation_error', 'analysis', 'model', 'suggestion'],
    previous.rev IS NULL
  );
  IF operation_type = 'comment.request_generation'
    AND previous.locked_comment = 'true'::jsonb AND previous.locked_motto = 'true'::jsonb THEN
    PERFORM reject_operation('COMMENT_LOCKED');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_comment_change(p_op jsonb, p_previous ppt.comments, p_fields jsonb)
RETURNS ppt.comments
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  next_fields jsonb := coalesce(comment_value(p_previous), '{}'::jsonb) || p_fields;
  target comments;
BEGIN
  IF p_previous.rev IS NULL THEN
    INSERT INTO comments (
      class_id, student_id, semester, observation, comment, motto, locked_comment, locked_motto,
      generation_status, last_op_id
    ) VALUES (
      p_op->>'class_id', payload->>'student_id', payload->>'semester',
      coalesce(next_fields->>'observation', ''), coalesce(next_fields->>'comment', ''),
      coalesce(next_fields->>'motto', ''), coalesce(next_fields->'comment_locked', 'false'),
      coalesce(next_fields->'motto_locked', 'false'), coalesce(next_fields->>'generation_status', 'idle'),
      p_op->>'op_id'
    ) RETURNING * INTO STRICT target;
  ELSE
    UPDATE comments
    SET observation = next_fields->>'observation', comment = next_fields->>'comment',
      motto = next_fields->>'motto', locked_comment = next_fields->'comment_locked',
      locked_motto = next_fields->'motto_locked', generation_status = next_fields->>'generation_status',
      generation_error = next_fields->>'generation_error', analysis = next_fields->>'analysis',
      model = next_fields->>'model', suggestion = nullif(next_fields->'suggestion', 'null'::jsonb),
      rev = rev + 1, last_op_id = p_op->>'op_id'
    WHERE class_id = p_previous.class_id AND student_id = p_previous.student_id AND semester = p_previous.semester
    RETURNING * INTO STRICT target;
  END IF;
  RETURN target;
END;
$$;

CREATE FUNCTION ppt.comment_changed_fields(p_previous jsonb, p_fields jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each(p_fields) WHERE (p_previous->key) IS DISTINCT FROM value;
$$;

CREATE FUNCTION ppt.comment_operation_outcome(
  p_previous ppt.comments, p_target ppt.comments, p_fields jsonb, p_result jsonb DEFAULT '{}'::jsonb
)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous_value jsonb := comment_value(p_previous);
  target_value jsonb := comment_value(p_target);
  omitted text[];
BEGIN
  IF p_previous.rev IS NOT NULL THEN
    SELECT ARRAY(SELECT key FROM jsonb_object_keys(previous_value) AS fields(key) WHERE NOT p_fields ? key)
    INTO omitted;
    previous_value := previous_value - omitted;
    target_value := target_value - omitted;
  END IF;
  RETURN (
    operation_result(p_noop => coalesce(p_previous.rev = p_target.rev, false)) || p_result,
    jsonb_build_array(entity_change(
      'comment', jsonb_build_object('student_id', p_target.student_id, 'semester', p_target.semester),
      coalesce(p_previous.rev, 0), p_target.rev, p_target.last_op_id, previous_value, target_value
    )), '[]'::jsonb
  )::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.apply_teacher_comment_operation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous comments := find_comment(p_op);
  target comments := previous;
  fields jsonb := (p_op->'payload') - ARRAY['student_id', 'semester'];
  changed jsonb;
BEGIN
  IF p_op->>'type' = 'comment.request_generation' THEN
    IF previous.generation_status IS DISTINCT FROM 'generating' THEN
      fields := jsonb_build_object('generation_status', 'generating', 'generation_error', NULL);
    END IF;
  END IF;
  changed := comment_changed_fields(comment_value(previous), fields);

  IF previous.rev IS NULL OR changed <> '{}'::jsonb THEN
    target := store_comment_change(p_op, previous, fields);
  END IF;
  IF p_op->>'type' = 'comment.request_generation' THEN
    fields := changed;
  END IF;
  RETURN comment_operation_outcome(previous, target, fields);
END;
$$;
