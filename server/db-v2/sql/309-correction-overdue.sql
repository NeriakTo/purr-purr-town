CREATE FUNCTION ppt.validate_correction_overdue(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['date']) OR NOT valid_calendar_day(p_payload->'date') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.correction_overdue_grace_days(p_class_id text)
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce((
    SELECT value::numeric::integer FROM settings_entries
    WHERE class_id = p_class_id AND key = 'correctionOverdueGraceDays'
  ), 1);
$$;

CREATE FUNCTION ppt.correction_overdue_targets(p_class_id text, p_date date, p_grace_days integer)
RETURNS SETOF ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT round.*
  FROM corrections AS round
  JOIN tasks USING (class_id, task_id)
  JOIN students USING (class_id, student_id)
  WHERE round.class_id = p_class_id AND round.status = 'required'
    AND p_date > round.due_on + p_grace_days
    AND NOT tasks.voided AND students.enrollment_status NOT IN ('transferred', 'archived');
$$;

CREATE FUNCTION ppt.has_correction_overdue_effect(p_round ppt.corrections)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM effects
    WHERE class_id = p_round.class_id AND student_id = p_round.student_id
      AND event = 'correction.overdue' AND subject_kind = 'correction' AND subject_key = p_round.correction_id
  );
$$;

CREATE FUNCTION ppt.mark_correction_round_overdue(p_round ppt.corrections, p_date date, p_op_id text)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE corrections SET overdue_on = p_date, rev = rev + 1, basis_rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_round.class_id AND correction_id = p_round.correction_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.apply_correction_overdue(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  op_key text := p_op->>'op_id';
  schedule_day date := (p_op->'payload'->>'date')::date;
  grace_days integer := correction_overdue_grace_days(class_key);
  target corrections;
  updated corrections;
  penalty effect_write;
  changes jsonb := '[]';
  transactions jsonb := '[]';
  effects_added jsonb := '[]';
  accounts_by_student jsonb := '{}';
  account_changes jsonb;
BEGIN
  FOR target IN
    SELECT * FROM correction_overdue_targets(class_key, schedule_day, grace_days)
    ORDER BY student_id COLLATE "C", correction_id COLLATE "C"
  LOOP
    IF target.overdue_on IS NULL THEN
      updated := mark_correction_round_overdue(target, schedule_day, op_key);
      changes := changes || jsonb_build_array(correction_round_change(target, updated, 'overdue_on', op_key));
    END IF;

    IF NOT has_correction_overdue_effect(target) THEN
      penalty := add_event_effect(
        class_key, target.student_id, 'correction.overdue', 'correction', target.correction_id, op_key, p_time
      );
      IF penalty.snapshot IS NOT NULL THEN
        transactions := transactions || jsonb_build_array((penalty.entry).transaction_id);
        effects_added := effects_added || jsonb_build_array(penalty.snapshot);
        accounts_by_student := accounts_by_student || jsonb_build_object(
          target.student_id,
          merge_account_change(accounts_by_student->target.student_id, (penalty.entry).account_change)
        );
      END IF;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"), '[]'::jsonb)
    INTO account_changes FROM jsonb_each(accounts_by_student);
  changes := changes || account_changes;
  RETURN (operation_result(transactions, effects_added, p_noop => changes = '[]'::jsonb), changes, '[]'::jsonb);
END;
$$;
