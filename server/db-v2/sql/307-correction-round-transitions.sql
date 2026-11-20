CREATE FUNCTION ppt.check_correction_round_confirm(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT check_open_correction_round_change(p_op, p_actor, ARRAY[]::text[], ARRAY['required', 'returned'], true);
$$;

CREATE FUNCTION ppt.check_correction_round_redo(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
BEGIN
  IF NOT valid_v4_op_id(payload->>'next_correction_id') OR NOT valid_correction_round_date(payload->'next_due_on') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM check_open_correction_round_change(
    p_op, p_actor, ARRAY['next_correction_id', 'next_due_on'], ARRAY['returned'], true
  );
  PERFORM require_unused_correction_round_id(p_op->>'class_id', payload->>'next_correction_id');
END;
$$;

CREATE FUNCTION ppt.check_correction_round_cancel(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_op->'payload'->'reverse_effects') IS DISTINCT FROM 'boolean' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM check_open_correction_round_change(
    p_op, p_actor, ARRAY['reverse_effects'], ARRAY['required', 'returned'], false
  );
END;
$$;

CREATE FUNCTION ppt.check_correction_round_due(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  due jsonb := p_op->'payload'->'due_on';
BEGIN
  IF due IS NULL OR NOT valid_correction_round_date(due) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM check_open_correction_round_change(
    p_op, p_actor, ARRAY['due_on'], ARRAY['required', 'returned'], false
  );
END;
$$;

CREATE FUNCTION ppt.apply_correction_round_redo(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  previous corrections := load_correction_round(p_op->>'class_id', payload->>'correction_id');
  closed corrections;
  next_round corrections;
BEGIN
  closed := store_correction_round_status(previous, 'redo', op_key);
  next_round := insert_correction_round(
    previous.class_id, previous.task_id, previous.student_id, payload->>'next_correction_id',
    (payload->>'next_due_on')::date, NULL, op_key
  );
  RETURN (operation_result(), jsonb_build_array(
    correction_round_change(previous, closed, 'status', op_key),
    correction_round_change(NULL, next_round, NULL, op_key)
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION ppt.store_correction_round_due(p_row ppt.corrections, p_due_on date, p_op_id text)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE corrections SET due_on = p_due_on, rev = rev + 1, basis_rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_row.class_id AND correction_id = p_row.correction_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.apply_correction_round_due(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  previous corrections := load_correction_round(p_op->>'class_id', payload->>'correction_id');
  due date := (payload->>'due_on')::date;
  updated corrections := previous;
  unchanged boolean := previous.due_on IS NOT DISTINCT FROM due;
BEGIN
  IF NOT unchanged THEN
    updated := store_correction_round_due(previous, due, op_key);
  END IF;
  RETURN (operation_result(p_noop => unchanged),
    jsonb_build_array(correction_round_change(previous, updated, 'due_on', op_key)), '[]'::jsonb);
END;
$$;
