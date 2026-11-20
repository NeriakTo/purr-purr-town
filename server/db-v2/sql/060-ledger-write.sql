CREATE TYPE ppt.ledger_entry AS (transaction_id text, account_change jsonb);

CREATE FUNCTION ppt.require_active_student(p_class_id text, p_student_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  enrollment text;
BEGIN
  SELECT enrollment_status INTO enrollment FROM students
  WHERE class_id = p_class_id AND student_id = p_student_id;
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF enrollment IN ('transferred', 'archived') THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.update_account(
  p_class_id text, p_student_id text, p_op_id text, p_amount numeric, p_earned_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  before_update accounts%ROWTYPE;
  after_update accounts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT before_update FROM accounts
  WHERE class_id = p_class_id AND student_id = p_student_id;

  UPDATE accounts
  SET balance = balance + p_amount, total_earned = total_earned + p_earned_delta,
      rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_class_id AND student_id = p_student_id
  RETURNING * INTO STRICT after_update;

  RETURN jsonb_build_object(
    'entity', 'account', 'key', jsonb_build_object('student_id', p_student_id),
    'prev_rev', before_update.rev, 'rev', after_update.rev, 'last_op_id', p_op_id,
    'prev_value', jsonb_build_object('balance', before_update.balance, 'total_earned', before_update.total_earned),
    'value', jsonb_build_object('balance', after_update.balance, 'total_earned', after_update.total_earned)
  );
END;
$$;

CREATE FUNCTION ppt.append_account_transaction(
  p_class_id text,
  p_student_id text,
  p_op_id text,
  p_kind text,
  p_amount numeric,
  p_earned_delta numeric,
  p_occurred_at timestamptz,
  p_effective_at timestamptz,
  p_reason text,
  p_root_transaction_id text DEFAULT NULL
)
RETURNS ppt.ledger_entry
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  entry ledger_entry;
BEGIN
  entry.transaction_id := gen_random_uuid()::text;
  entry.account_change := update_account(p_class_id, p_student_id, p_op_id, p_amount, p_earned_delta);
  INSERT INTO transactions (
    class_id, student_id, transaction_id, kind, amount, earned_delta, occurred_at,
    effective_at, reason, origin, op_id, root_transaction_id
  ) VALUES (
    p_class_id, p_student_id, entry.transaction_id, p_kind, p_amount, p_earned_delta,
    p_occurred_at, p_effective_at, p_reason, 'op', p_op_id, p_root_transaction_id
  );
  RETURN entry;
END;
$$;
