CREATE FUNCTION ppt.require_read_committed()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = '操作需要 read committed 交易隔離層級';
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_teacher_actor(p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_actor->>'kind' IN ('scheduler', 'system') THEN
    -- PPT-PENDING: actor_scheduler_system
    PERFORM pending_operation('actor_scheduler_system');
  END IF;
  IF p_actor->>'kind' IS DISTINCT FROM 'teacher'
    OR jsonb_typeof(p_actor->'id') IS DISTINCT FROM 'string'
    OR p_actor->>'id' = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = '此入口需要有效的老師身分';
  END IF;
END;
$$;

CREATE FUNCTION ppt.valid_operation_envelope(p_op jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_typeof(p_op) IS NOT DISTINCT FROM 'object'
    AND jsonb_typeof(p_op->'class_id') IS NOT DISTINCT FROM 'string'
    AND p_op->>'class_id' <> ''
    AND coalesce(octet_length(convert_to((p_op->'payload')::text, 'UTF8')), 0) <= 64 * 1024;
$$;

CREATE FUNCTION ppt.valid_v4_op_id(p_op_id text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(p_op_id COLLATE "C" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false);
$$;

CREATE FUNCTION ppt.can_access_class(p_class_id text, p_actor jsonb)
RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_actor->>'kind' = 'teacher' AND EXISTS (
    SELECT 1 FROM class_ownership
    WHERE class_id = p_class_id AND teacher_id = p_actor->>'id'
  );
$$;

CREATE FUNCTION ppt.lock_authorized_class(p_class_id text, p_actor jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  PERFORM class_id FROM classes WHERE class_id = p_class_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN can_access_class(p_class_id, p_actor);
END;
$$;

CREATE FUNCTION ppt.lock_teacher_operation_class(p_class_id text, p_op_id text, p_actor jsonb)
RETURNS ppt.operation_code
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  PERFORM require_teacher_actor(p_actor);

  -- Step 1: check access without locking.
  IF NOT can_access_class(p_class_id, p_actor) THEN
    RETURN 'CLASS_FORBIDDEN';
  END IF;
  IF NOT valid_v4_op_id(p_op_id) THEN
    RETURN 'INVALID_OP_ID';
  END IF;

  -- Step 2: lock the class row, then check access again.
  IF NOT lock_authorized_class(p_class_id, p_actor) THEN
    RETURN 'CLASS_FORBIDDEN';
  END IF;
  RETURN NULL;
END;
$$;
