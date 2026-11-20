CREATE FUNCTION ppt.load_correction_round(p_class_id text, p_correction_id text)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM corrections WHERE class_id = p_class_id AND correction_id = p_correction_id;
$$;

CREATE FUNCTION ppt.open_correction_round(
  p_class_id text, p_task_id text, p_student_id text, p_exclude_id text DEFAULT NULL
)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM corrections
  WHERE class_id = p_class_id AND task_id = p_task_id AND student_id = p_student_id
    AND status IN ('required', 'returned') AND correction_id IS DISTINCT FROM p_exclude_id;
$$;

CREATE FUNCTION ppt.correction_round_key(p_row ppt.corrections)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('correction_id', p_row.correction_id);
$$;

CREATE FUNCTION ppt.correction_round_value(p_row ppt.corrections)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'status', p_row.status, 'round', p_row.round, 'due_on', p_row.due_on, 'overdue_on', p_row.overdue_on
  );
$$;

CREATE FUNCTION ppt.correction_round_change(
  p_before ppt.corrections, p_after ppt.corrections, p_field text, p_op_id text
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT entity_change(
    'correction', correction_round_key(p_after), coalesce(p_before.rev, 0), p_after.rev, p_op_id,
    CASE WHEN p_before.rev IS NOT NULL THEN jsonb_build_object(p_field, to_jsonb(p_before)->p_field) END,
    CASE WHEN p_before.rev IS NULL THEN
      correction_round_value(p_after)
        || jsonb_build_object('task_id', p_after.task_id, 'student_id', p_after.student_id, 'note', p_after.note)
    ELSE jsonb_build_object(p_field, to_jsonb(p_after)->p_field) END
  ) || jsonb_build_object('prev_basis_rev', coalesce(p_before.basis_rev, 0), 'basis_rev', p_after.basis_rev);
$$;

CREATE FUNCTION ppt.insert_correction_round(
  p_class_id text, p_task_id text, p_student_id text, p_correction_id text, p_due_on date, p_note text, p_op_id text
)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO corrections (class_id, task_id, student_id, correction_id, round, status, due_on, note, last_op_id)
  SELECT p_class_id, p_task_id, p_student_id, p_correction_id,
    coalesce(max(round), 0) + 1, 'required', p_due_on, p_note, p_op_id
  FROM corrections WHERE class_id = p_class_id AND task_id = p_task_id AND student_id = p_student_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.store_correction_round_status(
  p_row ppt.corrections, p_status text, p_op_id text
)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE corrections SET status = p_status, rev = rev + 1, basis_rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_row.class_id AND correction_id = p_row.correction_id
  RETURNING *;
$$;
