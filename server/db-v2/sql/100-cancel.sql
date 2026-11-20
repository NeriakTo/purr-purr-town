CREATE FUNCTION ppt.cancel_locked_operation(p_class_id text, p_op_id text, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_time timestamptz := clock_timestamp();
  new_receipt jsonb := operation_receipt(p_op_id, 'cancelled', 'OP_CANCELLED');
  existing operations%ROWTYPE;
BEGIN
  INSERT INTO operations (op_id, class_id, actor_kind, actor_id, status, code, recorded_at, receipt)
  VALUES (p_op_id, p_class_id, p_actor->>'kind', p_actor->>'id', 'cancelled', 'OP_CANCELLED', op_time, new_receipt)
  ON CONFLICT (op_id) DO NOTHING;
  IF FOUND THEN
    RETURN new_receipt;
  END IF;

  SELECT * INTO STRICT existing FROM operations WHERE op_id = p_op_id;
  IF NOT same_operation_actor(existing, p_class_id, p_actor) THEN
    RETURN retry_receipt(p_op_id, 'OP_ID_REUSED');
  END IF;
  RETURN replay_receipt(existing.receipt);
END;
$$;

CREATE FUNCTION ppt.cancel_operation(class_id text, op_id text, actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  access_error operation_code;
BEGIN
  PERFORM require_read_committed();
  PERFORM require_teacher_actor(actor);
  access_error := lock_operation_class(class_id, op_id, actor);
  IF access_error IS NOT NULL THEN
    RETURN retry_receipt(op_id, access_error);
  END IF;
  RETURN cancel_locked_operation(class_id, op_id, actor);
END;
$$;
