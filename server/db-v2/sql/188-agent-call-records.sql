CREATE FUNCTION ppt.agent_call_entries(p_ops jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'op_id', op->>'op_id', 'content_hash', encode(operation_content_hash(op), 'hex')
  ) ORDER BY position)
  FROM jsonb_array_elements(p_ops) WITH ORDINALITY AS inputs(op, position);
$$;

CREATE FUNCTION ppt.agent_call_matches(p_call ppt.agent_calls, p_class_id text, p_entries jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_call.class_id = p_class_id AND p_entries = (
    SELECT jsonb_agg(entry - 'is_new' ORDER BY position)
    FROM jsonb_array_elements(p_call.entries) WITH ORDINALITY AS saved(entry, position)
  );
$$;

CREATE FUNCTION ppt.agent_new_operations(p_ops jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(op ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(p_ops) WITH ORDINALITY AS inputs(op, position)
  WHERE NOT EXISTS (SELECT 1 FROM operations WHERE op_id = op->>'op_id');
$$;

CREATE FUNCTION ppt.execute_new_agent_operations(p_ops jsonb, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op jsonb;
  receipts jsonb := '{}';
BEGIN
  FOR op IN SELECT value FROM jsonb_array_elements(p_ops) WITH ORDINALITY ORDER BY ordinality
  LOOP
    receipts := receipts || jsonb_build_object(op->>'op_id', submit_locked_operation(op, p_actor));
  END LOOP;
  RETURN receipts;
END;
$$;

CREATE FUNCTION ppt.agent_batch_receipts(
  p_class_id text, p_call_id text, p_entries jsonb, p_actor jsonb, p_new_receipts jsonb
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('call_id', p_call_id, 'receipts', jsonb_agg(
    coalesce(p_new_receipts->(entry->>'op_id'), resolve_operation_conflict(
      jsonb_build_object('op_id', entry->>'op_id', 'class_id', p_class_id),
      p_actor, decode(entry->>'content_hash', 'hex')
    )) ORDER BY position
  ))
  FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS inputs(entry, position);
$$;

CREATE FUNCTION ppt.store_agent_call(
  p_class_id text, p_call_id text, p_note text, p_entries jsonb, p_receipts jsonb, p_time timestamptz
)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO agent_calls (class_id, call_id, note, entries, created_at)
  SELECT p_class_id, p_call_id, p_note, jsonb_agg(entry || jsonb_build_object(
    'is_new', coalesce(receipt->>'status' <> 'retry' AND receipt->'replayed' = 'false'::jsonb, false)
  ) ORDER BY position), p_time
  FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS inputs(entry, position)
  CROSS JOIN LATERAL (SELECT p_receipts->(entry->>'op_id') AS receipt) AS result;
$$;
