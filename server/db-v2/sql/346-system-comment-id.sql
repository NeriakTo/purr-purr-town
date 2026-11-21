CREATE FUNCTION ppt.comment_apply_op_id(p_request_op_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT uuid_v5(operation_uuid_namespace(), 'comment.apply_generated:' || p_request_op_id);
$$;
