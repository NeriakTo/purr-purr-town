CREATE FUNCTION ppt.validate_shop_purchase(p_payload jsonb, p_has_expect boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_has_expect
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'student_id') IS DISTINCT FROM 'string'
    OR p_payload->>'student_id' = ''
    OR jsonb_typeof(p_payload->'product_id') IS DISTINCT FROM 'string'
    OR p_payload->>'product_id' = ''
    OR NOT valid_v4_op_id(p_payload->>'item_id')
    OR jsonb_typeof(p_payload->'expect_price_points') IS DISTINCT FROM 'number'
    OR p_payload - ARRAY['student_id', 'product_id', 'item_id', 'expect_price_points'] <> '{}'::jsonb THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF (p_payload->>'expect_price_points')::numeric < 0 THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.product_price_points(p_product ppt.products)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  tier text;
  default_rate numeric;
  rate_text text;
BEGIN
  CASE p_product.price_unit
    WHEN 'point' THEN RETURN p_product.price;
    WHEN 'fish' THEN tier := 'tier1'; default_rate := 100;
    WHEN 'cookie' THEN tier := 'tier2'; default_rate := 1000;
  END CASE;

  SELECT substring(value #>> ARRAY[tier, 'rate'] FROM '^[[:space:]]*[+]?([0-9]+)')
  INTO rate_text FROM settings_entries
  WHERE class_id = p_product.class_id AND key = 'currency';
  RETURN p_product.price * coalesce(nullif(rate_text::numeric, 0), default_rate);
END;
$$;

CREATE FUNCTION ppt.check_purchase_terms(
  p_product ppt.products, p_student_id text, p_item_id text, p_price numeric, p_expected_price numeric
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  balance numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_items WHERE class_id = p_product.class_id AND item_id = p_item_id
  ) THEN
    PERFORM reject_operation('ID_CONFLICT');
  END IF;
  IF p_price <> p_expected_price THEN
    PERFORM reject_operation('PRICE_CHANGED');
  END IF;
  IF coalesce(p_product.stock, 0) = 0 THEN
    PERFORM reject_operation('OUT_OF_STOCK');
  END IF;
  SELECT a.balance INTO STRICT balance FROM accounts AS a
  WHERE a.class_id = p_product.class_id AND a.student_id = p_student_id;
  IF balance < p_price THEN
    PERFORM reject_operation('INSUFFICIENT_BALANCE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_purchased_item(p_op jsonb, p_product ppt.products, p_transaction_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item inventory_items;
BEGIN
  INSERT INTO inventory_items (
    class_id, item_id, student_id, product_id, product_name, product_icon, purchase_transaction_id, last_op_id
  ) VALUES (
    p_product.class_id, p_op->'payload'->>'item_id', p_op->'payload'->>'student_id',
    p_product.product_id, p_product.name, p_product.icon, p_transaction_id, p_op->>'op_id'
  ) RETURNING * INTO item;
  RETURN jsonb_build_object(
    'entity', 'inventory_item', 'key', jsonb_build_object('item_id', item.item_id),
    'prev_rev', 0, 'rev', item.rev, 'last_op_id', item.last_op_id,
    'prev_value', NULL, 'value', to_jsonb(item) - ARRAY['class_id', 'item_id', 'rev', 'last_op_id']
  );
END;
$$;

CREATE FUNCTION ppt.decrement_product_stock(p_product ppt.products, p_op_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE products
  SET stock = stock - 1, rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_product.class_id AND product_id = p_product.product_id
  RETURNING jsonb_build_object(
    'entity', 'product', 'key', jsonb_build_object('product_id', product_id),
    'prev_rev', p_product.rev, 'rev', rev, 'last_op_id', last_op_id,
    'prev_value', jsonb_build_object('stock', p_product.stock), 'value', jsonb_build_object('stock', stock)
  );
$$;

CREATE FUNCTION ppt.apply_shop_purchase(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  student_key text := payload->>'student_id';
  product products;
  price numeric;
  entry ledger_entry;
  item_change jsonb;
  product_change jsonb;
BEGIN
  SELECT * INTO product FROM products
  WHERE class_id = class_key AND product_id = payload->>'product_id';
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  PERFORM require_active_student(class_key, student_key);
  IF product.disabled THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;

  price := product_price_points(product);
  PERFORM check_purchase_terms(
    product, student_key, payload->>'item_id', price, (payload->>'expect_price_points')::numeric
  );
  entry := append_account_transaction(
    class_key, student_key, p_op->>'op_id', 'shop_purchase', -price, 0, p_time, p_time, '購買' || product.name
  );
  item_change := store_purchased_item(p_op, product, entry.transaction_id);
  product_change := decrement_product_stock(product, p_op->>'op_id');
  RETURN (
    operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(item_change, product_change, entry.account_change),
    '[]'::jsonb
  )::operation_outcome;
END;
$$;
