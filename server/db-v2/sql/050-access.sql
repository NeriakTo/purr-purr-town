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
  IF p_actor->>'kind' IS DISTINCT FROM 'teacher'
    OR jsonb_typeof(p_actor->'id') IS DISTINCT FROM 'string'
    OR p_actor->>'id' = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = '此入口需要有效的老師身分';
  END IF;
END;
$$;

CREATE FUNCTION ppt.scheduler_actor()
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('kind', 'scheduler', 'id', 'scheduler');
$$;

CREATE FUNCTION ppt.system_actor()
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('kind', 'system', 'id', 'system');
$$;

CREATE FUNCTION ppt.require_submit_actor(p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_actor->>'kind' = 'scheduler' THEN
    IF p_actor IS DISTINCT FROM scheduler_actor() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = '此入口需要有效的排程身分';
    END IF;
  ELSIF p_actor->>'kind' = 'system' THEN
    IF p_actor IS DISTINCT FROM system_actor() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = '此入口需要有效的系統身分';
    END IF;
  ELSE
    PERFORM require_teacher_actor(p_actor);
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

CREATE FUNCTION ppt.valid_v5_op_id(p_op_id text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(p_op_id COLLATE "C" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false);
$$;

CREATE FUNCTION ppt.can_access_class(p_class_id text, p_actor jsonb)
RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE
    WHEN p_actor->>'kind' = 'teacher' THEN EXISTS (
      SELECT 1 FROM class_ownership
      WHERE class_id = p_class_id AND teacher_id = p_actor->>'id'
    )
    WHEN p_actor->>'kind' IN ('agent', 'scheduler') THEN EXISTS (
      SELECT 1 FROM class_authorizations
      WHERE class_id = p_class_id AND actor_kind = p_actor->>'kind'
    )
    WHEN p_actor = system_actor() THEN EXISTS (
      SELECT 1 FROM classes WHERE class_id = p_class_id
    )
    ELSE false
  END;
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

-- The entry point has validated the actor before calling this function.
CREATE FUNCTION ppt.lock_operation_class(p_class_id text, p_op_id text, p_actor jsonb, p_op jsonb DEFAULT NULL)
RETURNS ppt.operation_code
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  -- Step 1: check access without locking.
  IF NOT can_access_class(p_class_id, p_actor) THEN
    RETURN 'CLASS_FORBIDDEN';
  END IF;
  IF NOT (CASE WHEN p_actor->>'kind' IN ('scheduler', 'system')
    THEN valid_v5_op_id(p_op_id) ELSE valid_v4_op_id(p_op_id) END) THEN
    RETURN 'INVALID_OP_ID';
  END IF;
  IF p_actor->>'kind' = 'system' AND p_op->>'type' = 'comment.apply_generated'
    AND (jsonb_typeof(p_op->'payload'->'request_op_id') IS DISTINCT FROM 'string'
      OR p_op_id IS DISTINCT FROM comment_apply_op_id(p_op->'payload'->>'request_op_id')) THEN
    RETURN 'INVALID_OP_ID';
  END IF;

  -- Step 2: lock the class row, then check access again.
  IF NOT lock_authorized_class(p_class_id, p_actor) THEN
    RETURN 'CLASS_FORBIDDEN';
  END IF;
  RETURN NULL;
END;
$$;
