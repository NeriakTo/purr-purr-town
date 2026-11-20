CREATE FUNCTION ppt.check_undo_correction(p_target ppt.operations, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  chain transaction_chain := undo_target_transaction_chain(p_target);
  root transactions := chain.root;
  later record;
BEGIN
  SELECT t.kind, o.op_id, o.actor_kind, o.actor_id, o.committed_at INTO later
  FROM transactions AS t JOIN operations AS o USING (class_id, op_id)
  WHERE t.class_id = root.class_id AND t.root_transaction_id = root.transaction_id
    AND t.kind IN ('correction', 'reversal') AND o.class_seq > p_target.class_seq
  ORDER BY o.class_seq DESC
  LIMIT 1;
  IF FOUND THEN
    PERFORM reject_undo_conflict(p_actor, 'tx_changed_later', jsonb_build_object(
      'transaction_id', root.transaction_id, 'effective_amount', chain.effective_amount,
      'reversed', later.kind = 'reversal', 'last_op_id', later.op_id,
      'actor', jsonb_build_object('kind', later.actor_kind, 'id', later.actor_id),
      'committed_at', later.committed_at
    ));
  END IF;
END;
$$;

CREATE FUNCTION ppt.undo_transaction_correction(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  original transactions;
  chain transaction_chain := undo_target_transaction_chain(p_target);
  root transactions := chain.root;
  entry ledger_entry;
BEGIN
  SELECT * INTO STRICT original FROM transactions
  WHERE class_id = p_target.class_id AND transaction_id = p_target.receipt->'result'->'transactions'->>0;
  entry := append_account_transaction(
    root.class_id, root.student_id, p_op_id, 'correction', -original.amount, root_earned_delta(root, -original.amount),
    p_time, root.effective_at, '撤銷' || original.reason, root.transaction_id
  );
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(entry.account_change), '[]'::jsonb)::operation_outcome;
END;
$$;
