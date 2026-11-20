CREATE FUNCTION ppt.apply_correction_round_creation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  note text := payload->>'note';
  -- Unicode White_Space, including non-breaking spaces regardless of database locale.
  blank_note_pattern constant text := U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]*$';
  op_key text := p_op->>'op_id';
  created corrections;
BEGIN
  created := insert_correction_round(
    p_op->>'class_id', payload->>'task_id', payload->>'student_id', payload->>'correction_id',
    (payload->>'due_on')::date, CASE WHEN note COLLATE "C" !~ blank_note_pattern THEN note END, op_key
  );
  RETURN (operation_result(), jsonb_build_array(correction_round_change(NULL, created, NULL, op_key)), '[]'::jsonb);
END;
$$;

CREATE FUNCTION ppt.apply_correction_round_return(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  op_key text := p_op->>'op_id';
  previous corrections := load_correction_round(p_op->>'class_id', p_op->'payload'->>'correction_id');
  updated corrections := store_correction_round_status(previous, 'returned', op_key);
BEGIN
  RETURN (operation_result(), jsonb_build_array(correction_round_change(previous, updated, 'status', op_key)), '[]'::jsonb);
END;
$$;
