CREATE FUNCTION ppt.latest_root_correction_op(p_class_id text, p_transaction_id text)
RETURNS text
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT t.op_id
  FROM transactions AS t JOIN operations AS o USING (class_id, op_id)
  WHERE t.class_id = p_class_id AND t.root_transaction_id = p_transaction_id AND t.kind = 'correction'
  ORDER BY o.class_seq DESC NULLS LAST
  LIMIT 1;
$$;

CREATE FUNCTION ppt.undo_amount_warning(
  p_chain ppt.transaction_chain, p_original_amount numeric, p_original_effect jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_chain.effective_amount <> p_original_amount THEN jsonb_build_array(undo_change_warning(
    'amount_changed', p_original_effect, (p_chain.root).transaction_id,
    latest_root_correction_op((p_chain.root).class_id, (p_chain.root).transaction_id),
    p_original_amount, p_chain.effective_amount
  )) ELSE '[]'::jsonb END;
$$;

CREATE FUNCTION ppt.undo_root_transaction(p_chain ppt.transaction_chain, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  root transactions := p_chain.root;
  prior_reversal transactions;
  entry ledger_entry;
  warnings jsonb;
BEGIN
  SELECT * INTO prior_reversal FROM transactions
  WHERE class_id = root.class_id AND root_transaction_id = root.transaction_id AND kind = 'reversal';
  IF FOUND THEN
    warnings := jsonb_build_array(undo_change_warning(
      'already_reversed', NULL, root.transaction_id, prior_reversal.op_id, root.amount, NULL
    ));
    RETURN (operation_result(p_noop => true), '[]'::jsonb, warnings)::operation_outcome;
  END IF;

  warnings := undo_amount_warning(p_chain, root.amount);
  entry := append_root_reversal(p_chain, p_op_id, p_time);
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(entry.account_change), warnings)::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.undo_points_operation(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT undo_root_transaction(
    load_transaction_chain(p_target.class_id, p_target.receipt->'result'->'transactions'->>0), p_op_id, p_time
  );
$$;
