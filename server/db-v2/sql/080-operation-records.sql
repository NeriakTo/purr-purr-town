CREATE FUNCTION ppt.operation_content_hash(p_op jsonb)
RETURNS bytea
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT sha256(convert_to(jsonb_build_object(
    'type', p_op->'type', 'class_id', p_op->'class_id',
    'payload', p_op->'payload', 'expect', p_op->'expect'
  )::text, 'UTF8'));
$$;

CREATE FUNCTION ppt.claim_operation(p_op jsonb, p_actor jsonb, p_hash bytea, p_time timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  -- The claim remains private to this transaction and is finalized before returning.
  INSERT INTO operations (
    op_id, class_id, actor_kind, actor_id, type, payload, expect, content_hash,
    status, recorded_at, batch_id, client_time, client_seq
  ) VALUES (
    p_op->>'op_id', p_op->>'class_id', p_actor->>'kind', p_actor->>'id',
    p_op->>'type', p_op->'payload', p_op->'expect', p_hash,
    'held', p_time, p_op->>'batch_id', p_op->>'client_time', p_op->'client_seq'
  )
  ON CONFLICT (op_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION ppt.same_operation_actor(p_existing ppt.operations, p_class_id text, p_actor jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_existing.class_id = p_class_id
     AND p_existing.actor_kind = p_actor->>'kind'
     AND p_existing.actor_id = p_actor->>'id';
$$;

CREATE FUNCTION ppt.replay_receipt(p_receipt jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_set(p_receipt, '{replayed}', 'true');
$$;

CREATE FUNCTION ppt.resolve_operation_conflict(p_op jsonb, p_actor jsonb, p_hash bytea)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  existing operations%ROWTYPE;
BEGIN
  SELECT * INTO STRICT existing FROM operations WHERE op_id = p_op->>'op_id';
  IF NOT same_operation_actor(existing, p_op->>'class_id', p_actor) THEN
    RETURN retry_receipt(existing.op_id, 'OP_ID_REUSED');
  END IF;
  IF existing.status = 'cancelled' OR existing.content_hash = p_hash THEN
    RETURN replay_receipt(existing.receipt);
  END IF;
  RETURN retry_receipt(existing.op_id, 'OP_ID_REUSED');
END;
$$;

CREATE FUNCTION ppt.save_operation_receipt(p_receipt jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE operations
  SET status = p_receipt->>'status',
      code = (p_receipt->>'code')::operation_code,
      class_seq = (p_receipt->>'class_seq')::bigint,
      committed_at = (p_receipt->>'committed_at')::timestamptz,
      receipt = p_receipt
  WHERE op_id = p_receipt->>'op_id';
$$;
