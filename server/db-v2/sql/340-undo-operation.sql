CREATE FUNCTION ppt.validate_undo_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['target_op_id'])
      OR NOT has_nonempty_string(p_payload, 'target_op_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.load_undo_target(p_op jsonb)
RETURNS ppt.operations
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM operations WHERE class_id = p_op->>'class_id' AND op_id = p_op->'payload'->>'target_op_id';
$$;

CREATE FUNCTION ppt.require_undoable_target(p_target ppt.operations, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_actor->>'kind' = 'agent' AND (
      p_target.actor_kind IS DISTINCT FROM 'agent' OR p_target.actor_id IS DISTINCT FROM p_actor->>'id'
    ) THEN
    PERFORM reject_operation('SCOPE_FORBIDDEN');
  END IF;
  IF p_target.op_id IS NULL THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF p_target.status <> 'committed' THEN
    PERFORM reject_operation('NOT_UNDOABLE');
  END IF;

  CASE p_target.type
    WHEN 'points.adjust', 'points.apply_rule', 'submission.set_status',
        'tx.correct', 'shop.purchase', 'inventory.use' THEN NULL;
    WHEN 'correction.require', 'correction.mark_returned', 'correction.confirm',
        'correction.redo', 'correction.cancel' THEN NULL;
    WHEN 'confirmation.confirm' THEN
      IF NOT EXISTS (
        SELECT 1 FROM confirmations
        WHERE class_id = p_target.class_id AND confirmation_id = p_target.payload->>'confirmation_id'
          AND kind = 'leader_proposal'
      ) THEN
        PERFORM reject_operation('NOT_UNDOABLE');
      END IF;
    -- PPT-PENDING: undo_payroll
    ELSE PERFORM reject_operation('NOT_UNDOABLE');
  END CASE;

  IF EXISTS (
    SELECT 1 FROM operations
    WHERE class_id = p_target.class_id AND type = 'op.undo' AND status = 'committed'
      AND payload->>'target_op_id' = p_target.op_id
  ) THEN
    PERFORM reject_operation('ALREADY_UNDONE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_undo_operation(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target operations := load_undo_target(p_op);
BEGIN
  PERFORM require_undoable_target(target, p_actor);
  IF target.receipt->'result'->'noop' = 'true'::jsonb THEN
    RETURN;
  END IF;

  CASE target.type
    WHEN 'points.adjust', 'points.apply_rule' THEN NULL;
    WHEN 'submission.set_status', 'confirmation.confirm' THEN PERFORM check_undo_submission(target, p_actor);
    WHEN 'correction.require', 'correction.mark_returned', 'correction.confirm',
        'correction.redo', 'correction.cancel' THEN PERFORM check_undo_correction_round(target, p_actor);
    WHEN 'tx.correct' THEN PERFORM check_undo_correction(target, p_actor);
    WHEN 'shop.purchase' THEN PERFORM check_undo_item(target, p_actor, 'held');
    WHEN 'inventory.use' THEN PERFORM check_undo_item(target, p_actor, 'used');
    ELSE RAISE EXCEPTION '可撤銷的操作缺少預檢函式';
  END CASE;
END;
$$;

CREATE FUNCTION ppt.apply_undo_operation(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target operations := load_undo_target(p_op);
  op_key text := p_op->>'op_id';
  outcome operation_outcome;
BEGIN
  IF target.receipt->'result'->'noop' = 'true'::jsonb THEN
    outcome := (operation_result(p_noop => true), '[]'::jsonb, '[]'::jsonb)::operation_outcome;
  ELSE
    CASE target.type
      WHEN 'points.adjust', 'points.apply_rule' THEN outcome := undo_points_operation(target, op_key, p_time);
      WHEN 'submission.set_status', 'confirmation.confirm' THEN outcome := undo_submission(target, op_key, p_time);
      WHEN 'correction.require', 'correction.mark_returned', 'correction.confirm',
          'correction.redo', 'correction.cancel' THEN outcome := undo_correction_round(target, op_key, p_time);
      WHEN 'tx.correct' THEN outcome := undo_transaction_correction(target, op_key, p_time);
      WHEN 'shop.purchase' THEN outcome := undo_purchase(target, op_key, p_time);
      WHEN 'inventory.use' THEN outcome := undo_inventory_use(target, op_key, p_time);
      ELSE RAISE EXCEPTION '可撤銷的操作缺少寫入函式';
    END CASE;
  END IF;
  RETURN undo_outcome(target.op_id, outcome);
END;
$$;
