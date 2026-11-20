CREATE FUNCTION ppt.load_undo_item(p_target ppt.operations)
RETURNS ppt.inventory_items
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM inventory_items
  WHERE class_id = p_target.class_id
    AND item_id = receipt_entity_change(p_target.receipt, 'inventory_item')->'key'->>'item_id';
$$;

CREATE FUNCTION ppt.check_undo_item(p_target ppt.operations, p_actor jsonb, p_expected_status text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item inventory_items := load_undo_item(p_target);
BEGIN
  IF item.status IS DISTINCT FROM p_expected_status THEN
    PERFORM reject_undo_conflict(p_actor, 'item_state_changed', current_entity_revision(
      p_target.class_id, item.last_op_id, item.rev, jsonb_build_object('status', item.status)
    ));
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_undo_item_status(p_item ppt.inventory_items, p_status text, p_op_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE inventory_items
  SET status = p_status, rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_item.class_id AND item_id = p_item.item_id
  RETURNING entity_change(
    'inventory_item', jsonb_build_object('item_id', item_id), p_item.rev, rev, last_op_id,
    jsonb_build_object('status', p_item.status), jsonb_build_object('status', status)
  );
$$;

CREATE FUNCTION ppt.restore_purchased_stock(p_class_id text, p_product_id text, p_op_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE products
  SET stock = stock + 1, rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_class_id AND product_id = p_product_id
  RETURNING entity_change(
    'product', jsonb_build_object('product_id', product_id), rev - 1, rev, last_op_id,
    jsonb_build_object('stock', stock - 1), jsonb_build_object('stock', stock)
  );
$$;

CREATE FUNCTION ppt.undo_purchase(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item inventory_items := load_undo_item(p_target);
  product_key text := receipt_entity_change(p_target.receipt, 'product')->'key'->>'product_id';
  chain transaction_chain := undo_target_transaction_chain(p_target);
  entry ledger_entry;
  item_change jsonb;
  product_change jsonb;
BEGIN
  entry := append_root_reversal(chain, p_op_id, p_time);
  item_change := store_undo_item_status(item, 'returned', p_op_id);
  product_change := restore_purchased_stock(p_target.class_id, product_key, p_op_id);
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(item_change, product_change, entry.account_change),
    undo_amount_warning(chain, (chain.root).amount))::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.undo_inventory_use(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item_change jsonb;
  entry ledger_entry;
BEGIN
  item_change := store_undo_item_status(load_undo_item(p_target), 'held', p_op_id);
  entry := append_root_reversal(undo_target_transaction_chain(p_target), p_op_id, p_time);
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(item_change, entry.account_change), '[]'::jsonb)::operation_outcome;
END;
$$;
