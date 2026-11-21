CREATE FUNCTION ppt.validate_batch_undo_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['batch_id', 'expect_op_count'])
      OR NOT has_nonempty_string(p_payload, 'batch_id')
      OR NOT is_bounded_integer(p_payload->'expect_op_count', 1, 50) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.batch_undo_members(p_class_id text, p_batch_id text)
RETURNS TABLE (target_id text, status text, class_seq bigint, entry_order bigint)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT op.op_id, op.status, op.class_seq, member.entry_order
  FROM agent_calls AS call
  CROSS JOIN LATERAL agent_batch_members(call) AS member
  JOIN operations AS op ON op.class_id = call.class_id AND op.op_id = member.op_id
  WHERE call.class_id = p_class_id AND call.call_id = p_batch_id;
$$;

CREATE FUNCTION ppt.check_batch_undo_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  batch_key text := p_op->'payload'->>'batch_id';
  expected_count numeric := (p_op->'payload'->'expect_op_count')::numeric;
  member_count integer;
  committed_count integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'committed')
  INTO member_count, committed_count
  FROM batch_undo_members(class_key, batch_key);
  IF member_count = 0 THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;

  IF EXISTS (
    SELECT 1 FROM operations
    WHERE class_id = class_key AND type = 'batch.undo' AND status = 'committed'
      AND payload->>'batch_id' = batch_key
  ) THEN
    PERFORM reject_operation('ALREADY_UNDONE');
  END IF;
  IF committed_count <> expected_count THEN
    PERFORM reject_operation('STALE_STATE', jsonb_build_object('op_count', committed_count));
  END IF;
END;
$$;

CREATE FUNCTION ppt.prepare_batch_undo_items(p_op jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  items jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'target_op_id', member.target_id,
    'undo_op_id', CASE WHEN member.status = 'committed' THEN
      batch_undo_op_id(p_op->>'op_id', member.target_id) END
  ) ORDER BY member.class_seq DESC NULLS LAST, member.entry_order)
  INTO items
  FROM batch_undo_members(p_op->>'class_id', p_op->'payload'->>'batch_id') AS member;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(items) AS planned(item)
    JOIN operations ON op_id = item->>'undo_op_id'
  ) THEN
    RAISE EXCEPTION '整批撤銷的內部編號已被占用';
  END IF;
  RETURN items;
END;
$$;

CREATE FUNCTION ppt.execute_batch_undo_item(p_outer jsonb, p_item jsonb, p_actor jsonb, p_time timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op jsonb := jsonb_build_object(
    'op_id', p_item->>'undo_op_id', 'class_id', p_outer->>'class_id',
    'type', 'op.undo', 'batch_id', p_outer->>'op_id',
    'payload', jsonb_build_object('target_op_id', p_item->>'target_op_id')
  );
  receipt jsonb;
BEGIN
  IF NOT claim_operation(op, p_actor, operation_content_hash(op), p_time) THEN
    RAISE EXCEPTION '整批撤銷的內部編號已被占用';
  END IF;
  receipt := execute_claimed_operation(op, p_actor, p_time);
  PERFORM save_operation_receipt(receipt);
  RETURN receipt;
END;
$$;

CREATE FUNCTION ppt.batch_undo_result_item(p_item jsonb, p_receipt jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_item || CASE
    WHEN p_receipt IS NULL THEN jsonb_build_object('outcome', 'skipped', 'code', 'NOT_UNDOABLE')
    WHEN p_receipt->>'status' = 'committed' THEN jsonb_build_object('outcome', 'undone')
    ELSE jsonb_build_object('outcome', 'skipped', 'code', p_receipt->'code')
      || CASE WHEN p_receipt ? 'current' THEN jsonb_build_object('current', p_receipt->'current')
              ELSE '{}'::jsonb END
  END;
$$;

CREATE FUNCTION ppt.batch_undo_item_warnings(p_item jsonb, p_receipt jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(
    warning || jsonb_build_object('target_op_id', p_item->'target_op_id') ORDER BY position
  ), '[]'::jsonb)
  FROM jsonb_array_elements(p_receipt->'warnings') WITH ORDINALITY AS entries(warning, position)
  WHERE warning->>'code' = 'UNDO_EFFECT_MANUALLY_CHANGED';
$$;

CREATE FUNCTION ppt.apply_batch_undo_operation(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item jsonb;
  receipt jsonb;
  items jsonb := '[]';
  warnings jsonb := '[]';
  noop boolean := true;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(prepare_batch_undo_items(p_op)) WITH ORDINALITY ORDER BY ordinality
  LOOP
    receipt := NULL;
    IF item->>'undo_op_id' IS NOT NULL THEN
      receipt := execute_batch_undo_item(p_op, item, p_actor, p_time);
      warnings := warnings || batch_undo_item_warnings(item, receipt);
      IF receipt->>'status' = 'committed' AND receipt->'result'->'noop' = 'false'::jsonb THEN
        noop := false;
      END IF;
    END IF;
    items := items || jsonb_build_array(batch_undo_result_item(item, receipt));
  END LOOP;

  RETURN (operation_result(p_noop => noop) || jsonb_build_object(
    'batch', jsonb_build_object('batch_id', p_op->'payload'->'batch_id',
                               'op_count', (p_op->'payload'->'expect_op_count')::integer),
    'items', items
  ), '[]'::jsonb, warnings)::operation_outcome;
END;
$$;
