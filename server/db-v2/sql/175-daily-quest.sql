CREATE FUNCTION ppt.daily_quest_submissions(p_class_id text, p_student_id text, p_date date)
RETURNS TABLE (status ppt.submission_status, legacy_status_at_import ppt.submission_status)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT submission.status, submission.legacy_status_at_import
  FROM tasks AS task
  JOIN submissions AS submission USING (class_id, task_id)
  WHERE task.class_id = p_class_id AND task.due_on = p_date AND NOT task.voided
    AND submission.student_id = p_student_id AND submission.assignment_active;
$$;

CREATE FUNCTION ppt.apply_daily_quest(
  p_class_id text, p_student_id text, p_date date, p_op_id text, p_time timestamptz
)
RETURNS ppt.submission_effect_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  date_key text := to_char(p_date, 'YYYY-MM-DD');
  event_key constant rule_event := 'daily_quest.complete';
  legacy_day boolean;
  completed boolean;
  active_effect effects;
  change effect_write;
BEGIN
  SELECT bool_or(legacy_status_at_import <> 'pending'),
         bool_and(status IN ('on_time', 'makeup', 'leave', 'exempt')) AND bool_or(status = 'on_time')
  INTO legacy_day, completed
  FROM daily_quest_submissions(p_class_id, p_student_id, p_date);

  IF legacy_day THEN
    RETURN (operation_result(), NULL, jsonb_build_array(jsonb_build_object(
      'code', 'LEGACY_DAY_NO_DAILY_QUEST', 'student_id', p_student_id, 'date', date_key
    )))::submission_effect_outcome;
  END IF;

  SELECT * INTO active_effect FROM effects
  WHERE class_id = p_class_id AND student_id = p_student_id AND event = event_key
    AND subject_kind = 'date' AND subject_key = date_key AND status = 'active';

  IF completed AND active_effect.effect_id IS NULL THEN
    change := add_event_effect(p_class_id, p_student_id, event_key, 'date', date_key, p_op_id, p_time);
    IF change.snapshot IS NOT NULL THEN
      RETURN (operation_result(
        jsonb_build_array((change.entry).transaction_id), jsonb_build_array(change.snapshot)
      ), (change.entry).account_change, '[]'::jsonb)::submission_effect_outcome;
    END IF;
  ELSIF NOT coalesce(completed, false) AND active_effect.effect_id IS NOT NULL THEN
    change := reverse_event_effect(active_effect, p_op_id, p_time);
    RETURN (operation_result(
      jsonb_build_array((change.entry).transaction_id), p_effects_reversed => jsonb_build_array(change.snapshot)
    ), (change.entry).account_change, '[]'::jsonb)::submission_effect_outcome;
  END IF;
  RETURN (operation_result(), NULL, '[]'::jsonb)::submission_effect_outcome;
END;
$$;
