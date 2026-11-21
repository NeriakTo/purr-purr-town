CREATE FUNCTION ppt.valid_calendar_day(p_value jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_typeof(p_value) IS NOT DISTINCT FROM 'string'
    AND coalesce((p_value #>> '{}') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
    AND pg_input_is_valid(p_value #>> '{}', 'date');
$$;

CREATE FUNCTION ppt.validate_task_fields(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF (p_payload ? 'title' AND NOT has_nonempty_string(p_payload, 'title'))
    OR (p_payload ? 'task_type' AND NOT has_nonempty_string(p_payload, 'task_type'))
    OR (p_payload ? 'page_text' AND jsonb_typeof(p_payload->'page_text') NOT IN ('string', 'null'))
    OR (p_payload ? 'due_on' AND NOT valid_calendar_day(p_payload->'due_on')) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.validate_task_assignee_list(p_assignees jsonb, p_allow_empty boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_assignees) IS DISTINCT FROM 'array' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF (NOT p_allow_empty AND jsonb_array_length(p_assignees) = 0) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignees) AS item(value)
    GROUP BY value
    HAVING count(*) > 1 OR jsonb_typeof(value) <> 'string' OR value = '""'::jsonb
  ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.validate_task_create(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(
      p_payload, ARRAY['task_id', 'title', 'task_type', 'page_text', 'published_on', 'due_on', 'assignee_ids']
    ) OR NOT valid_v4_op_id(p_payload->>'task_id')
    OR NOT (p_payload ?& ARRAY['title', 'task_type', 'due_on'])
    OR NOT valid_calendar_day(p_payload->'published_on') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_task_fields(p_payload);
  IF p_payload ? 'assignee_ids' THEN
    PERFORM validate_task_assignee_list(p_payload->'assignee_ids');
  END IF;
END;
$$;

CREATE FUNCTION ppt.validate_task_update(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['task_id', 'title', 'task_type', 'page_text', 'due_on'])
    OR NOT has_nonempty_string(p_payload, 'task_id')
    OR NOT (p_payload ?| ARRAY['title', 'task_type', 'page_text', 'due_on']) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_task_fields(p_payload);
END;
$$;
