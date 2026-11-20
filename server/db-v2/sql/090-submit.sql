CREATE FUNCTION ppt.check_operation_role(p_type jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  allowed_roles text[];
BEGIN
  SELECT roles INTO allowed_roles FROM operation_definition(p_type);
  IF NOT FOUND THEN
    PERFORM reject_operation('UNKNOWN_OP_TYPE');
  END IF;
  IF NOT coalesce(p_actor->>'kind' = ANY(allowed_roles), false) THEN
    PERFORM reject_operation('FORBIDDEN_ROLE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_operation_input_and_target(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_status text;
BEGIN
  SELECT status INTO STRICT class_status FROM classes WHERE class_id = p_op->>'class_id';
  IF class_status = 'archived' THEN
    PERFORM reject_operation('CLASS_ARCHIVED');
  END IF;

  PERFORM validate_operation_expect(p_op);
  CASE p_op->>'type'
    WHEN 'op.undo' THEN
      PERFORM validate_undo_payload(p_op->'payload');
      PERFORM check_undo_operation(p_op, p_actor);
    WHEN 'points.adjust' THEN
      PERFORM validate_points_adjust(p_op->'payload');
      PERFORM require_active_student(p_op->>'class_id', p_op->'payload'->>'student_id');
    WHEN 'tx.correct', 'tx.reverse' THEN
      PERFORM validate_transaction_change(p_op);
      PERFORM require_transaction_change(p_op);
    WHEN 'points.apply_rule' THEN
      PERFORM validate_points_apply_rule(p_op->'payload');
      PERFORM require_manual_rule_version(p_op, p_actor);
    WHEN 'setting.set' THEN
      PERFORM validate_setting_set(p_op->'payload');
      PERFORM require_setting_version(p_op);
    WHEN 'product.save', 'product.retire' THEN
      PERFORM validate_product_operation(p_op);
      PERFORM require_product_version(p_op);
    WHEN 'inventory.use' THEN
      PERFORM validate_inventory_use(p_op->'payload');
      PERFORM require_inventory_use(p_op);
    WHEN 'shop.purchase' THEN
      PERFORM validate_shop_purchase(p_op->'payload');
    WHEN 'submission.set_status' THEN
      PERFORM validate_submission_status(p_op->'payload');
      PERFORM require_submission_targets(
        p_op->>'class_id', p_op->'payload'->>'task_id', p_op->'payload'->>'student_id', p_actor
      );
    WHEN 'submission.propose' THEN
      PERFORM validate_submission_proposal(p_op->'payload');
      PERFORM require_proposal_target(p_op, p_actor);
    WHEN 'confirmation.confirm', 'confirmation.reject' THEN
      PERFORM validate_confirmation_payload(p_op->'payload');
    WHEN 'correction.require' THEN
      PERFORM check_correction_round_creation(p_op, p_actor);
    WHEN 'correction.mark_returned' THEN
      PERFORM check_correction_round_return(p_op, p_actor);
    WHEN 'rule.save' THEN
      PERFORM validate_rule_save(p_op->'payload');
    WHEN 'rule.retire' THEN
      PERFORM validate_rule_retire(p_op->'payload');
    WHEN 'task.create' THEN
      PERFORM validate_task_create(p_op->'payload');
    WHEN 'task.update' THEN
      PERFORM validate_task_update(p_op->'payload');
    WHEN 'task.void' THEN
      PERFORM validate_task_lifecycle(p_op->'payload', true);
    WHEN 'task.restore' THEN
      PERFORM validate_task_lifecycle(p_op->'payload', false);
    ELSE
      RAISE EXCEPTION '已知操作缺少輸入與目標檢查';
  END CASE;
END;
$$;

CREATE FUNCTION ppt.apply_operation(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  CASE p_op->>'type'
    WHEN 'op.undo' THEN RETURN apply_undo_operation(p_op, p_time);
    WHEN 'points.adjust' THEN RETURN apply_points_adjust(p_op, p_time);
    WHEN 'tx.reverse' THEN RETURN apply_transaction_reversal(p_op, p_time);
    WHEN 'tx.correct' THEN RETURN apply_transaction_correction(p_op, p_time);
    WHEN 'points.apply_rule' THEN RETURN apply_points_rule(p_op, p_actor, p_time);
    WHEN 'setting.set' THEN RETURN apply_setting_set(p_op);
    WHEN 'product.save', 'product.retire' THEN RETURN apply_product_operation(p_op);
    WHEN 'inventory.use' THEN RETURN apply_inventory_use(p_op, p_time);
    WHEN 'shop.purchase' THEN RETURN apply_shop_purchase(p_op, p_time);
    WHEN 'submission.set_status' THEN RETURN apply_submission_status(p_op, p_time);
    WHEN 'submission.propose' THEN RETURN apply_submission_proposal(p_op, p_time);
    WHEN 'confirmation.confirm', 'confirmation.reject' THEN RETURN apply_confirmation_operation(p_op, p_actor, p_time);
    WHEN 'correction.require' THEN RETURN apply_correction_round_creation(p_op);
    WHEN 'correction.mark_returned' THEN RETURN apply_correction_round_return(p_op);
    WHEN 'rule.save' THEN RETURN apply_rule_operation(p_op, p_time);
    WHEN 'rule.retire' THEN RETURN apply_rule_operation(p_op, p_time);
    WHEN 'task.create' THEN RETURN apply_task_create(p_op);
    WHEN 'task.update' THEN RETURN apply_task_update(p_op);
    WHEN 'task.void' THEN RETURN apply_task_lifecycle(p_op, p_time);
    WHEN 'task.restore' THEN RETURN apply_task_lifecycle(p_op, p_time);
    ELSE RAISE EXCEPTION '已知操作缺少寫入函式';
  END CASE;
END;
$$;

CREATE FUNCTION ppt.advance_class_sequence(p_class_id text)
RETURNS bigint
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE classes SET class_seq = class_seq + 1
  WHERE class_id = p_class_id
  RETURNING class_seq;
$$;

CREATE FUNCTION ppt.execute_claimed_operation(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  outcome operation_outcome;
  seq bigint;
  rejection_code text;
  rejection_detail text;
BEGIN
  -- Steps 4 and 5: apply role checks before operation input and target checks.
  PERFORM check_operation_role(p_op->'type', p_actor);
  PERFORM check_operation_input_and_target(p_op, p_actor);

  -- Step 6: apply and advance the sequence within this subtransaction.
  outcome := apply_operation(p_op, p_actor, p_time);
  seq := advance_class_sequence(p_op->>'class_id');
  RETURN operation_receipt(
    p_op->>'op_id', 'committed', 'OK', seq, p_time,
    outcome.result, outcome.changes, outcome.warnings
  );
EXCEPTION WHEN SQLSTATE 'P604R' THEN
  GET STACKED DIAGNOSTICS rejection_code = MESSAGE_TEXT, rejection_detail = PG_EXCEPTION_DETAIL;
  RETURN operation_receipt(
    p_op->>'op_id', 'rejected', rejection_code::operation_code,
    p_current => nullif(rejection_detail, '')::jsonb
  );
END;
$$;

-- The caller has validated the envelope and holds the authorized class lock.
CREATE FUNCTION ppt.submit_locked_operation(p_op jsonb, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_time timestamptz := clock_timestamp();
  content_hash bytea := operation_content_hash(p_op);
  receipt jsonb;
BEGIN
  -- Step 3: claim the globally unique operation ID, or resolve the existing claim.
  IF NOT claim_operation(p_op, p_actor, content_hash, op_time) THEN
    RETURN resolve_operation_conflict(p_op, p_actor, content_hash);
  END IF;

  receipt := execute_claimed_operation(p_op, p_actor, op_time);

  -- Step 7: save the receipt. The caller retains both the lock and transaction.
  PERFORM save_operation_receipt(receipt);
  RETURN receipt;
END;
$$;

CREATE FUNCTION ppt.submit_operation(op jsonb, actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_id text := CASE WHEN jsonb_typeof(op->'op_id') = 'string' THEN op->>'op_id' END;
  class_id text := op->>'class_id';
  access_error operation_code;
BEGIN
  PERFORM require_read_committed();
  IF NOT valid_operation_envelope(op) THEN
    RETURN retry_receipt(op_id, 'BAD_ENVELOPE');
  END IF;

  -- PPT-PENDING: class_create
  access_error := lock_teacher_operation_class(class_id, op_id, actor);
  IF access_error IS NOT NULL THEN
    RETURN retry_receipt(op_id, access_error);
  END IF;
  RETURN submit_locked_operation(op, actor);
END;
$$;
