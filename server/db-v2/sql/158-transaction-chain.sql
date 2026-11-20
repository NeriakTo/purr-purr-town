CREATE TYPE ppt.transaction_chain AS (root ppt.transactions, effective_amount numeric);

CREATE FUNCTION ppt.effective_transaction_amount(p_root ppt.transactions)
RETURNS numeric
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_root.amount + coalesce(sum(amount), 0) FROM transactions
  WHERE class_id = p_root.class_id AND student_id = p_root.student_id
    AND root_transaction_id = p_root.transaction_id AND kind IN ('correction', 'reversal');
$$;

CREATE FUNCTION ppt.load_transaction_chain(p_class_id text, p_transaction_id text)
RETURNS ppt.transaction_chain
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target transactions;
BEGIN
  SELECT * INTO target FROM transactions
  WHERE class_id = p_class_id AND transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target.kind IN ('correction', 'reversal') THEN
    SELECT * INTO STRICT target FROM transactions
    WHERE class_id = p_class_id AND transaction_id = target.root_transaction_id;
  END IF;
  RETURN (target, effective_transaction_amount(target))::transaction_chain;
END;
$$;

CREATE FUNCTION ppt.root_earned_delta(p_root ppt.transactions, p_amount numeric)
RETURNS numeric
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_root.kind IN ('adjust', 'rule_auto', 'payroll', 'legacy_general')
    THEN p_amount ELSE 0 END;
$$;
