CREATE FUNCTION ppt.validate_transaction_change(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  keys text[] := ARRAY['transaction_id', 'expect_effective_amount'];
BEGIN
  IF p_op->>'type' = 'tx.correct' THEN
    keys := keys || ARRAY['new_amount', 'reason'];
    IF NOT is_bounded_integer(payload->'new_amount', -100000, 100000)
        OR (payload ? 'reason' AND (jsonb_typeof(payload->'reason') <> 'string'
            OR char_length(payload->>'reason') > 100)) THEN
      PERFORM reject_operation('INVALID_PAYLOAD');
    END IF;
  END IF;
  IF NOT has_only_keys(payload, keys) OR NOT has_nonempty_string(payload, 'transaction_id')
      OR jsonb_typeof(payload->'expect_effective_amount') IS DISTINCT FROM 'number' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_transaction_change(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  chain transaction_chain := load_transaction_chain(p_op->>'class_id', p_op->'payload'->>'transaction_id');
  root transactions := chain.root;
  is_reversal boolean := p_op->>'type' = 'tx.reverse';
BEGIN
  IF root.transaction_id IS NULL THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF root.kind IN ('migration_opening_adjustment', 'legacy_orphan_correction')
      OR (root.kind = 'item_use' AND root.amount = 0)
      OR (is_reversal AND root.kind = 'shop_purchase' AND root.origin = 'op') THEN
    PERFORM reject_operation('TX_NOT_REVERSIBLE');
  END IF;
  IF (is_reversal AND chain.effective_amount = 0) OR EXISTS (SELECT 1 FROM transactions WHERE class_id = root.class_id
      AND root_transaction_id = root.transaction_id AND kind = 'reversal') THEN
    PERFORM reject_operation('TX_ALREADY_REVERSED');
  END IF;
  IF chain.effective_amount <> (p_op->'payload'->'expect_effective_amount')::numeric THEN
    PERFORM reject_operation('STALE_STATE', jsonb_build_object(
      'transaction_id', root.transaction_id, 'effective_amount', chain.effective_amount
    ));
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_transaction_correction(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  chain transaction_chain := load_transaction_chain(p_op->>'class_id', payload->>'transaction_id');
  root transactions := chain.root;
  delta numeric := (payload->'new_amount')::numeric - chain.effective_amount;
  reason text := payload->>'reason';
  entry ledger_entry;
BEGIN
  IF reason ~ '^[[:space:]　]*$' THEN
    reason := NULL;
  END IF;
  IF delta = 0 AND reason IS NULL THEN
    RETURN (operation_result(p_noop => true), '[]'::jsonb, '[]'::jsonb)::operation_outcome;
  END IF;
  entry := append_account_transaction(
    root.class_id, root.student_id, p_op->>'op_id', 'correction', delta, root_earned_delta(root, delta),
    p_time, root.effective_at, coalesce(reason, '更正' || root.reason), root.transaction_id
  );
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(entry.account_change), '[]'::jsonb)::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.apply_transaction_reversal(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_key text := p_op->>'op_id';
  chain transaction_chain := load_transaction_chain(p_op->>'class_id', p_op->'payload'->>'transaction_id');
  root transactions := chain.root;
  entry ledger_entry := append_root_reversal(chain, op_key, p_time);
  effect effects;
  reversed jsonb := '[]'::jsonb;
BEGIN
  FOR effect IN
    SELECT * FROM effects WHERE class_id = root.class_id AND student_id = root.student_id
      AND root_transaction_id = root.transaction_id AND status = 'active'
    ORDER BY effect_id
  LOOP
    reversed := reversed || jsonb_build_array(mark_effect_reversed(effect, op_key, chain));
  END LOOP;
  RETURN (operation_result(jsonb_build_array(entry.transaction_id), p_effects_reversed => reversed),
    jsonb_build_array(entry.account_change), '[]'::jsonb)::operation_outcome;
END;
$$;
