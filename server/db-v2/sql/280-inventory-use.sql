CREATE FUNCTION ppt.validate_inventory_use(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['item_id']) OR NOT has_nonempty_string(p_payload, 'item_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_inventory_use(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item_status text;
BEGIN
  SELECT status INTO item_status FROM inventory_items
  WHERE class_id = p_op->>'class_id' AND item_id = p_op->'payload'->>'item_id';
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF item_status = 'returned' THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
  IF item_status = 'used' THEN
    PERFORM reject_operation('ITEM_ALREADY_USED');
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_inventory_use(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_key text := p_op->>'op_id';
  item inventory_items;
  entry ledger_entry;
  change jsonb;
BEGIN
  UPDATE inventory_items
  SET status = 'used', rev = rev + 1, last_op_id = op_key
  WHERE class_id = p_op->>'class_id' AND item_id = p_op->'payload'->>'item_id'
  RETURNING * INTO STRICT item;
  change := entity_change('inventory_item', jsonb_build_object('item_id', item.item_id),
    item.rev - 1, item.rev, op_key, jsonb_build_object('status', 'held'), jsonb_build_object('status', item.status));
  entry := append_account_transaction(
    item.class_id, item.student_id, op_key, 'item_use', 0, 0, p_time, p_time, '使用道具' || item.product_name
  );
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(change, entry.account_change), '[]'::jsonb)::operation_outcome;
END;
$$;
