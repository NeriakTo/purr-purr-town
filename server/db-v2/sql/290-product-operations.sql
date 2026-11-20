CREATE FUNCTION ppt.validate_product_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
BEGIN
  IF NOT has_nonempty_string(payload, 'product_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF p_op->>'type' = 'product.retire' THEN
    IF NOT has_only_keys(payload, ARRAY['product_id']) THEN
      PERFORM reject_operation('INVALID_PAYLOAD');
    END IF;
    RETURN;
  END IF;
  IF NOT has_only_keys(payload, ARRAY[
      'product_id', 'name', 'icon', 'price', 'price_unit', 'stock', 'initial_stock', 'description'
    ])
    OR NOT has_nonempty_string(payload, 'name') OR char_length(payload->>'name') > 100
    OR NOT is_bounded_integer(payload->'price', 0, 100000)
    OR NOT is_bounded_integer(payload->'stock', 0, 100000)
    OR NOT is_bounded_integer(payload->'initial_stock', 0, 100000)
    OR NOT has_nonempty_string(payload, 'price_unit') OR payload->>'price_unit' NOT IN ('point', 'fish', 'cookie')
    OR (payload ? 'icon' AND jsonb_typeof(payload->'icon') <> 'string')
    OR (payload ? 'description' AND jsonb_typeof(payload->'description') <> 'string') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.product_value(p_product ppt.products)
RETURNS jsonb
LANGUAGE sql STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'name', p_product.name, 'icon', p_product.icon, 'price', p_product.price, 'price_unit', p_product.price_unit,
    'stock', p_product.stock, 'initial_stock', p_product.initial_stock,
    'description', p_product.description, 'disabled', p_product.disabled
  );
$$;

CREATE FUNCTION ppt.require_product_version(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  id text := p_op->'payload'->>'product_id';
  product products;
  is_new boolean;
BEGIN
  SELECT * INTO product FROM products WHERE class_id = p_op->>'class_id' AND product_id = id;
  is_new := NOT FOUND;
  IF is_new AND p_op->>'type' = 'product.retire' THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  PERFORM require_version_condition(
    p_op, 'product', jsonb_build_object('product_id', id), product.rev, product.last_op_id,
    CASE WHEN NOT is_new THEN product_value(product) END, is_new
  );
  IF is_new AND NOT valid_v4_op_id(id) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_product(p_product ppt.products, p_op_id text)
RETURNS ppt.products
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO products AS target (
    class_id, product_id, name, icon, price, price_unit, stock, initial_stock, description, disabled, last_op_id
  ) VALUES (
    p_product.class_id, p_product.product_id, p_product.name, p_product.icon, p_product.price,
    p_product.price_unit, p_product.stock, p_product.initial_stock, p_product.description, p_product.disabled, p_op_id
  ) ON CONFLICT (class_id, product_id) DO UPDATE
  SET name = excluded.name, icon = excluded.icon, price = excluded.price, price_unit = excluded.price_unit,
      stock = excluded.stock, initial_stock = excluded.initial_stock, description = excluded.description,
      disabled = excluded.disabled, last_op_id = excluded.last_op_id, rev = target.rev + 1
  RETURNING target.*;
$$;

CREATE FUNCTION ppt.apply_product_operation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  id text := payload->>'product_id';
  previous products;
  target products;
  previous_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM products WHERE class_id = class_key AND product_id = id;
  IF FOUND THEN
    previous_value := product_value(previous);
  END IF;

  IF p_op->>'type' = 'product.retire' THEN
    target := previous;
    target.disabled := true;
  ELSE
    target := jsonb_populate_record(NULL::products, payload - ARRAY['stock', 'initial_stock']);
    target.class_id := class_key;
    target.stock := (payload->'stock')::integer;
    target.initial_stock := (payload->'initial_stock')::integer;
    target.disabled := false;
  END IF;

  unchanged := product_value(target) IS NOT DISTINCT FROM previous_value;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_product(target, p_op->>'op_id');
  END IF;
  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'product', jsonb_build_object('product_id', id), coalesce(previous.rev, 0),
    target.rev, target.last_op_id,
    previous_value, product_value(target)
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
