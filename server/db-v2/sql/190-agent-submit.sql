CREATE FUNCTION ppt.agent_actor()
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('kind', 'agent', 'id', 'agent');
$$;

CREATE FUNCTION ppt.valid_agent_envelope(p_class_id text, p_ops jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_class_id IS NULL OR p_class_id = '' OR jsonb_typeof(p_ops) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_ops) NOT BETWEEN 1 AND 50 THEN
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

CREATE FUNCTION ppt.submit_locked_agent_batch(p_class_id text, p_call_id text, p_ops jsonb, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op jsonb;
  context jsonb := jsonb_build_object('class_id', p_class_id, 'batch_id', p_call_id);
  receipts jsonb := '[]';
BEGIN
  -- PPT-PENDING: agent_call_record
  -- PPT-PENDING: agent_limits
  FOR op IN SELECT value FROM jsonb_array_elements(p_ops) WITH ORDINALITY ORDER BY ordinality
  LOOP
    receipts := receipts || jsonb_build_array(submit_locked_operation(op || context, p_actor));
  END LOOP;
  RETURN jsonb_build_object('call_id', p_call_id, 'receipts', receipts);
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
  IF NOT valid_agent_envelope(class_id, ops) THEN
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
  -- PPT-PENDING: agent_note
  RETURN submit_locked_agent_batch(class_id, call_id, ops, actor);
END;
$$;
