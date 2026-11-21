CREATE FUNCTION ppt.agent_batch_members(p_call ppt.agent_calls)
RETURNS TABLE (op_id text, entry_order bigint)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT entry->>'op_id', entry_position
  FROM jsonb_array_elements(p_call.entries) WITH ORDINALITY AS saved(entry, entry_position)
  WHERE entry->'is_new' = 'true'::jsonb
  ORDER BY entry_position;
$$;

CREATE FUNCTION ppt.agent_pending_confirmations(p_class_id text)
RETURNS SETOF ppt.confirmations
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM confirmations
  WHERE class_id = p_class_id AND kind = 'agent_held' AND status = 'pending';
$$;

CREATE FUNCTION ppt.agent_pending_operations(p_class_id text, p_after timestamptz DEFAULT NULL)
RETURNS SETOF ppt.operations
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT op.*
  FROM agent_pending_confirmations(p_class_id) AS h
  JOIN agent_calls AS c ON c.call_id = h.batch_id AND c.class_id = h.class_id
  CROSS JOIN LATERAL agent_batch_members(c) AS member
  JOIN operations AS op ON op.op_id = member.op_id AND op.class_id = c.class_id
  WHERE op.status = 'held' AND (p_after IS NULL OR h.created_at > p_after);
$$;

CREATE FUNCTION ppt.agent_batch_was_held(p_class_id text, p_batch_id text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM confirmations
    WHERE class_id = p_class_id AND batch_id = p_batch_id AND kind = 'agent_held'
  );
$$;

CREATE FUNCTION ppt.store_held_agent_operations(
  p_ops jsonb, p_actor jsonb, p_time timestamptz, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  first_op jsonb := p_ops->0;
  confirmation_key text := first_op->>'op_id';
  held_result jsonb := operation_result() || jsonb_build_object(
    'confirmation_id', confirmation_key, 'held_reason', p_reason
  );
  op jsonb;
  receipt jsonb;
  receipts jsonb := '{}';
BEGIN
  FOR op IN SELECT value FROM jsonb_array_elements(p_ops) WITH ORDINALITY ORDER BY ordinality
  LOOP
    IF NOT claim_operation(op, p_actor, operation_content_hash(op), p_time) THEN
      RAISE EXCEPTION '暫緩操作的編號已被占用';
    END IF;
    receipt := operation_receipt(op->>'op_id', 'held', 'HELD_FOR_TEACHER', p_result => held_result);
    PERFORM save_operation_receipt(receipt);
    receipts := receipts || jsonb_build_object(op->>'op_id', receipt);
  END LOOP;

  INSERT INTO confirmations (
    class_id, confirmation_id, kind, created_op_id, created_at, last_op_id, batch_id, held_reason
  ) VALUES (
    first_op->>'class_id', confirmation_key, 'agent_held', confirmation_key, p_time,
    confirmation_key, first_op->>'batch_id', p_reason
  );
  RETURN receipts;
END;
$$;
