CREATE FUNCTION ppt.validate_points_adjust(p_payload jsonb, p_has_expect boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  amount numeric;
BEGIN
  IF p_has_expect
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'student_id') IS DISTINCT FROM 'string'
    OR p_payload->>'student_id' = ''
    OR jsonb_typeof(p_payload->'amount') IS DISTINCT FROM 'number'
    OR (p_payload ? 'reason' AND jsonb_typeof(p_payload->'reason') <> 'string') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  amount := (p_payload->>'amount')::numeric;
  IF amount = 0 OR abs(amount) > 100000 OR amount <> trunc(amount)
    OR char_length(p_payload->>'reason') > 100
    OR p_payload - ARRAY['student_id', 'amount', 'reason'] <> '{}'::jsonb THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_points_adjust(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  amount numeric := (payload->>'amount')::numeric;
  reason text := payload->>'reason';
  entry ledger_entry;
BEGIN
  IF reason IS NULL OR reason ~ '^[[:space:]]*$' THEN
    reason := '手動調整';
  END IF;
  entry := append_account_transaction(
    p_op->>'class_id', payload->>'student_id', p_op->>'op_id',
    'adjust', amount, amount, p_time, p_time, reason
  );
  RETURN (
    operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(entry.account_change),
    '[]'::jsonb
  )::operation_outcome;
END;
$$;
