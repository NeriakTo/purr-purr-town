CREATE FUNCTION ppt.agent_actor()
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('kind', 'agent', 'id', 'agent');
$$;

CREATE FUNCTION ppt.valid_agent_envelope(p_class_id text, p_ops jsonb, p_note text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_class_id IS NULL OR p_class_id = '' OR jsonb_typeof(p_ops) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_ops) NOT BETWEEN 1 AND 50
      OR length(p_note) > 1000
      OR octet_length(convert_to(p_ops::text, 'UTF8')) > 512 * 1024 THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_ops) AS op
    WHERE jsonb_typeof(op) <> 'object'
      OR NOT valid_operation_envelope(op || jsonb_build_object('class_id', p_class_id))
  ) AND NOT EXISTS (
    SELECT op->>'op_id' FROM jsonb_array_elements(p_ops) AS op
    WHERE valid_v4_op_id(op->>'op_id')
    GROUP BY op->>'op_id' HAVING count(*) > 1
  );
END;
$$;

CREATE FUNCTION ppt.valid_agent_ids(p_call_id text, p_ops jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT valid_v4_op_id(p_call_id) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_ops) AS op WHERE NOT valid_v4_op_id(op->>'op_id')
  );
$$;

CREATE FUNCTION ppt.agent_retry_receipt(p_call_id text, p_code ppt.operation_code)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('call_id', p_call_id, 'status', 'retry', 'code', p_code);
$$;

CREATE FUNCTION ppt.submit_locked_agent_batch(
  p_class_id text, p_call_id text, p_ops jsonb, p_actor jsonb, p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  call_time timestamptz := clock_timestamp();
  context jsonb := jsonb_build_object('class_id', p_class_id, 'batch_id', p_call_id);
  ops jsonb;
  entries jsonb;
  existing agent_calls;
  new_ops jsonb;
  receipts jsonb;
BEGIN
  SELECT jsonb_agg(op || context ORDER BY position) INTO ops
  FROM jsonb_array_elements(p_ops) WITH ORDINALITY AS inputs(op, position);
  entries := agent_call_entries(ops);

  SELECT * INTO existing FROM agent_calls WHERE call_id = p_call_id;
  IF FOUND THEN
    IF NOT agent_call_matches(existing, p_class_id, entries) THEN
      RETURN agent_retry_receipt(p_call_id, 'CALL_ID_REUSED');
    END IF;
    RETURN agent_batch_receipts(p_class_id, p_call_id, entries, p_actor, '{}'::jsonb);
  END IF;

  new_ops := agent_new_operations(ops);
  -- PPT-PENDING: agent_limits
  receipts := execute_new_agent_operations(new_ops, p_actor);
  PERFORM store_agent_call(p_class_id, p_call_id, p_note, entries, receipts, call_time);
  RETURN agent_batch_receipts(p_class_id, p_call_id, entries, p_actor, receipts);
END;
$$;

CREATE FUNCTION ppt.agent_submit(class_id text, call_id text, ops jsonb, note text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  actor jsonb := agent_actor();
BEGIN
  PERFORM require_read_committed();
  IF NOT valid_agent_envelope(class_id, ops, note) THEN
    RETURN agent_retry_receipt(call_id, 'BAD_ENVELOPE');
  END IF;
  IF NOT can_access_class(class_id, actor) THEN
    RETURN agent_retry_receipt(call_id, 'CLASS_FORBIDDEN');
  END IF;
  IF NOT valid_agent_ids(call_id, ops) THEN
    RETURN agent_retry_receipt(call_id, 'INVALID_OP_ID');
  END IF;
  IF NOT lock_authorized_class(class_id, actor) THEN
    RETURN agent_retry_receipt(call_id, 'CLASS_FORBIDDEN');
  END IF;
  RETURN submit_locked_agent_batch(class_id, call_id, ops, actor, note);
END;
$$;
