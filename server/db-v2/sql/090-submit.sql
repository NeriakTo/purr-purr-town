CREATE FUNCTION ppt.check_operation_role(p_type jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_type IS DISTINCT FROM '"points.adjust"'::jsonb THEN
    PERFORM reject_operation('UNKNOWN_OP_TYPE');
  END IF;
  IF p_actor->>'kind' IS DISTINCT FROM 'teacher' THEN
    PERFORM reject_operation('FORBIDDEN_ROLE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_operation_input_and_target(p_op jsonb)
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

  CASE p_op->>'type'
    WHEN 'points.adjust' THEN
      PERFORM validate_points_adjust(p_op->'payload', p_op ? 'expect');
      PERFORM require_active_student(p_op->>'class_id', p_op->'payload'->>'student_id');
    ELSE
      RAISE EXCEPTION '已知操作缺少輸入與目標檢查';
  END CASE;
END;
$$;

CREATE FUNCTION ppt.apply_operation(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  CASE p_op->>'type'
    WHEN 'points.adjust' THEN RETURN apply_points_adjust(p_op, p_time);
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
  PERFORM check_operation_input_and_target(p_op);

  -- Step 6: apply and advance the sequence within this subtransaction.
  outcome := apply_operation(p_op, p_time);
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
