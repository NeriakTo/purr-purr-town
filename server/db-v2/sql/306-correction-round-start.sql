CREATE FUNCTION ppt.apply_correction_round_creation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  note text := payload->>'note';
  created corrections;
BEGIN
  created := insert_correction_round(
    p_op->>'class_id', payload->>'task_id', payload->>'student_id', payload->>'correction_id',
    (payload->>'due_on')::date, CASE WHEN note !~ '^[[:space:]]*$' THEN note END, p_op->>'op_id'
  );
  RETURN (operation_result(), jsonb_build_array(correction_round_change(NULL, created, NULL)), '[]'::jsonb);
END;
$$;

CREATE FUNCTION ppt.apply_correction_round_return(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous corrections := load_correction_round(p_op->>'class_id', p_op->'payload'->>'correction_id');
  updated corrections := store_correction_round_status(previous, 'returned', p_op->>'op_id');
BEGIN
  RETURN (operation_result(), jsonb_build_array(correction_round_change(previous, updated, 'status')), '[]'::jsonb);
END;
$$;
