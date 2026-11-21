CREATE FUNCTION ppt.validate_duty_pay(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['date', 'include_legacy_periods'])
    OR NOT valid_calendar_day(p_payload->'date')
    OR (p_payload ? 'include_legacy_periods' AND jsonb_typeof(p_payload->'include_legacy_periods') <> 'boolean') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.load_duty_pay_job(p_class_id text, p_job_id text)
RETURNS ppt.jobs
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  job jobs;
BEGIN
  SELECT * INTO STRICT job FROM jobs WHERE class_id = p_class_id AND job_id = p_job_id;
  RETURN job;
END;
$$;

CREATE FUNCTION ppt.require_duty_pay_targets(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  job_id text := duty_job_id(class_key);
  duty daily_duties := load_daily_duty(class_key, (p_op->'payload'->>'date')::date);
BEGIN
  IF job_id IS NULL THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
  PERFORM load_duty_pay_job(class_key, job_id);
  IF duty.student_ids IS NULL OR duty.student_ids = '[]'::jsonb THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_duty_pay(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  day_key text := payload->>'date';
  duty_day date := day_key::date;
  job jobs := load_duty_pay_job(class_key, duty_job_id(class_key));
  roster daily_duties := load_daily_duty(class_key, duty_day);
  cutover_day date;
  is_legacy boolean;
  student_key text;
  receipt_key jsonb;
  skip_reason text;
  payment effect_write;
  outcome payroll_outcome := empty_payroll_outcome();
BEGIN
  IF job.salary = 0 THEN
    RETURN finish_payroll_outcome(outcome);
  END IF;

  SELECT cutover_date INTO STRICT cutover_day FROM classes WHERE class_id = class_key;
  is_legacy := NOT coalesce((payload->>'include_legacy_periods')::boolean, false) AND duty_day < cutover_day;
  FOR student_key IN SELECT student_id FROM payroll_students(class_key, roster.student_ids) LOOP
    receipt_key := duty_key(day_key) || jsonb_build_object('student_id', student_key);
    skip_reason := CASE
      WHEN has_payroll_effect(class_key, student_key, 'duty_pay', 'date', day_key) THEN 'already_paid'
      WHEN is_legacy THEN 'legacy_period'
    END;
    IF skip_reason IS NOT NULL THEN
      outcome.skipped := outcome.skipped || jsonb_build_array(receipt_key || jsonb_build_object('reason', skip_reason));
    ELSE
      payment := write_payroll_effect(job, student_key, p_op->>'op_id', p_time, 'duty_pay', 'date', day_key, day_key);
      outcome := record_payroll_write(outcome, payment, student_key, receipt_key);
    END IF;
  END LOOP;
  RETURN finish_payroll_outcome(outcome);
END;
$$;
