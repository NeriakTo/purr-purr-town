CREATE FUNCTION ppt.reverse_payroll_effects(p_chain ppt.transaction_chain, p_op_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  root transactions := p_chain.root;
  effect effects;
  snapshots jsonb := '[]'::jsonb;
BEGIN
  FOR effect IN
    SELECT * FROM effects WHERE class_id = root.class_id AND student_id = root.student_id
      AND root_transaction_id = root.transaction_id AND status = 'active'
    ORDER BY effect_id
  LOOP
    snapshots := snapshots || jsonb_build_array(mark_effect_reversed(effect, p_op_id, p_chain));
  END LOOP;
  RETURN snapshots;
END;
$$;

CREATE FUNCTION ppt.undo_payroll_operation(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  root_id text;
  chain transaction_chain;
  outcome operation_outcome;
  account_change jsonb;
  student_key text;
  accounts jsonb := '{}'::jsonb;
  undo_transactions jsonb := '[]'::jsonb;
  snapshots jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
BEGIN
  FOR root_id IN
    SELECT id FROM jsonb_array_elements_text(p_target.receipt->'result'->'transactions')
      WITH ORDINALITY AS roots(id, position)
    ORDER BY position
  LOOP
    chain := load_transaction_chain(p_target.class_id, root_id);
    outcome := undo_root_transaction(chain, p_op_id, p_time);
    warnings := warnings || outcome.warnings;
    IF (outcome.result->>'noop')::boolean THEN
      CONTINUE;
    END IF;

    undo_transactions := undo_transactions || (outcome.result->'transactions');
    snapshots := snapshots || reverse_payroll_effects(chain, p_op_id);
    account_change := outcome.changes->0;
    student_key := account_change->'key'->>'student_id';
    accounts := accounts || jsonb_build_object(
      student_key, merge_account_change(accounts->student_key, account_change)
    );
  END LOOP;

  RETURN (
    operation_result(undo_transactions, p_effects_reversed => snapshots, p_noop => undo_transactions = '[]'::jsonb),
    payroll_account_changes(accounts), warnings
  )::operation_outcome;
END;
$$;
