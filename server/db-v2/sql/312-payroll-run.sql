CREATE FUNCTION ppt.job_payroll_period(p_cycle text, p_date date)
RETURNS TABLE (period text, first_day date)
LANGUAGE sql STABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT period, first_day
  FROM (VALUES
    ('daily', to_char(p_date, 'YYYY-MM-DD'), p_date),
    ('weekly', to_char(p_date, 'IYYY-"W"IW'), date_trunc('week', p_date::timestamp)::date),
    ('monthly', to_char(p_date, 'YYYY-MM'), date_trunc('month', p_date::timestamp)::date),
    ('semester', semester_at(p_date),
      CASE WHEN extract(month FROM p_date) = 1
        THEN (make_date(extract(year FROM p_date)::integer, 8, 1) - interval '1 year')::date
        WHEN extract(month FROM p_date) <= 7 THEN make_date(extract(year FROM p_date)::integer, 2, 1)
        ELSE make_date(extract(year FROM p_date)::integer, 8, 1) END),
    ('once', 'once', NULL)
  ) AS cycles(cycle, period, first_day)
  WHERE cycle = p_cycle;
$$;

CREATE FUNCTION ppt.validate_payroll_run(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['job_ids', 'pay_date', 'include_legacy_periods'])
    OR (p_payload ? 'pay_date' AND NOT valid_calendar_day(p_payload->'pay_date'))
    OR (p_payload ? 'include_legacy_periods' AND jsonb_typeof(p_payload->'include_legacy_periods') <> 'boolean') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  PERFORM validate_task_assignee_list(p_payload->'job_ids');
END;
$$;

CREATE FUNCTION ppt.require_payroll_jobs(p_class_id text, p_job_ids jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_job_ids) AS requested(id)
    LEFT JOIN jobs AS job ON job.class_id = p_class_id AND job.job_id = requested.id
    WHERE job.job_id IS NULL
  ) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
END;
$$;

CREATE FUNCTION ppt.payroll_job_receipt_key(p_job_id text, p_period text, p_student_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('job_id', p_job_id, 'period', p_period, 'student_id', p_student_id);
$$;

CREATE FUNCTION ppt.apply_job_payroll(
  p_outcome ppt.payroll_outcome, p_job ppt.jobs, p_op_id text, p_time timestamptz, p_period text, p_legacy boolean
)
RETURNS ppt.payroll_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  student_key text;
  subject text := p_job.job_id || '|' || p_period;
  receipt_key jsonb;
  payment effect_write;
  has_unpaid boolean := false;
BEGIN
  FOR student_key IN SELECT student_id FROM payroll_students(p_job.class_id, p_job.assignee_ids) LOOP
    receipt_key := payroll_job_receipt_key(p_job.job_id, p_period, student_key);
    IF has_payroll_effect(p_job.class_id, student_key, 'payroll', 'job_period', subject) THEN
      p_outcome.skipped := p_outcome.skipped || jsonb_build_array(
        receipt_key || jsonb_build_object('reason', 'already_paid')
      );
    ELSIF p_legacy THEN
      has_unpaid := true;
    ELSE
      payment := write_payroll_effect(p_job, student_key, p_op_id, p_time, 'payroll', 'job_period', subject, p_period);
      p_outcome := record_payroll_write(p_outcome, payment, student_key, receipt_key);
    END IF;
  END LOOP;
  IF has_unpaid THEN
    p_outcome.skipped := p_outcome.skipped || jsonb_build_array(
      payroll_job_receipt_key(p_job.job_id, p_period, NULL) || jsonb_build_object('reason', 'legacy_period')
    );
  END IF;
  RETURN p_outcome;
END;
$$;

CREATE FUNCTION ppt.apply_payroll_run(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  pay_day date := coalesce((payload->>'pay_date')::date, (p_time AT TIME ZONE 'Asia/Taipei')::date);
  duty_id text := duty_job_id(class_key);
  cutover_day date;
  include_legacy boolean := coalesce((payload->>'include_legacy_periods')::boolean, false);
  job jobs;
  job_period text;
  first_day date;
  is_legacy boolean;
  outcome payroll_outcome := empty_payroll_outcome();
BEGIN
  SELECT cutover_date INTO STRICT cutover_day FROM classes WHERE class_id = class_key;
  FOR job IN
    SELECT j.* FROM jsonb_array_elements_text(payload->'job_ids') WITH ORDINALITY AS requested(id, position)
    JOIN jobs AS j ON j.class_id = class_key AND j.job_id = requested.id
    ORDER BY requested.position
  LOOP
    IF job.disabled THEN
      CONTINUE;
    END IF;
    IF job.job_id = duty_id THEN
      outcome.skipped := outcome.skipped || jsonb_build_array(
        payroll_job_receipt_key(job.job_id, NULL, NULL) || jsonb_build_object('reason', 'duty_job')
      );
      CONTINUE;
    END IF;
    IF job.salary = 0 THEN
      CONTINUE;
    END IF;

    SELECT period, period_info.first_day INTO STRICT job_period, first_day
    FROM job_payroll_period(job.cycle, pay_day) AS period_info;
    is_legacy := NOT include_legacy AND CASE WHEN job.cycle = 'once' THEN job.origin = 'migration'
      ELSE coalesce(first_day < cutover_day, false) END;
    outcome := apply_job_payroll(outcome, job, p_op->>'op_id', p_time, job_period, is_legacy);
  END LOOP;
  RETURN finish_payroll_outcome(outcome);
END;
$$;
