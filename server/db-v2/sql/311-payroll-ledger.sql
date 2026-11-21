CREATE TYPE ppt.payroll_outcome AS (
  transactions jsonb, effects_added jsonb, accounts_by_student jsonb, paid jsonb, skipped jsonb
);

CREATE FUNCTION ppt.empty_payroll_outcome()
RETURNS ppt.payroll_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT ROW('[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)::payroll_outcome;
$$;

CREATE FUNCTION ppt.payroll_account_changes(p_accounts jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"), '[]'::jsonb)
  FROM jsonb_each(p_accounts);
$$;

CREATE FUNCTION ppt.finish_payroll_outcome(p_payroll ppt.payroll_outcome)
RETURNS ppt.operation_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT ROW(
    operation_result(p_payroll.transactions, p_payroll.effects_added, p_noop => p_payroll.transactions = '[]'::jsonb)
      || jsonb_build_object('paid', p_payroll.paid, 'skipped', p_payroll.skipped),
    payroll_account_changes(p_payroll.accounts_by_student), '[]'::jsonb
  )::operation_outcome;
$$;

CREATE FUNCTION ppt.payroll_students(p_class_id text, p_students jsonb)
RETURNS TABLE (student_id text)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT s.student_id FROM students AS s
  WHERE s.class_id = p_class_id AND p_students ? s.student_id
    AND s.enrollment_status IN ('enrolled', 'home_study')
  ORDER BY s.student_id COLLATE "C";
$$;

CREATE FUNCTION ppt.has_payroll_effect(
  p_class_id text, p_student_id text, p_event ppt.rule_event, p_subject_kind text, p_subject_key text
)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM effects WHERE class_id = p_class_id AND student_id = p_student_id
      AND event = p_event AND subject_kind = p_subject_kind AND subject_key = p_subject_key AND status = 'active'
  );
$$;

CREATE FUNCTION ppt.write_payroll_effect(
  p_job ppt.jobs, p_student_id text, p_op_id text, p_time timestamptz,
  p_event ppt.rule_event, p_subject_kind text, p_subject_key text, p_period text
)
RETURNS ppt.effect_write
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  entry ledger_entry;
  effect_key text := gen_random_uuid()::text;
  effect effects;
BEGIN
  entry := append_account_transaction(
    p_job.class_id, p_student_id, p_op_id, 'payroll', p_job.salary, p_job.salary,
    p_time, p_time, p_job.title || ' 薪資 (' || p_period || ')'
  );
  INSERT INTO effects (
    class_id, effect_id, student_id, event, subject_kind, subject_key,
    root_transaction_id, status, origin, lineage_id, created_op_id
  ) VALUES (
    p_job.class_id, effect_key, p_student_id, p_event, p_subject_kind, p_subject_key,
    entry.transaction_id, 'active', 'op', effect_key, p_op_id
  ) RETURNING * INTO effect;
  RETURN (entry, effect_identity(effect) || jsonb_build_object('amount', p_job.salary))::effect_write;
END;
$$;

CREATE FUNCTION ppt.record_payroll_write(
  p_outcome ppt.payroll_outcome, p_payment ppt.effect_write, p_student_id text, p_paid jsonb
)
RETURNS ppt.payroll_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  entry ledger_entry := p_payment.entry;
BEGIN
  p_outcome.transactions := p_outcome.transactions || jsonb_build_array(entry.transaction_id);
  p_outcome.effects_added := p_outcome.effects_added || jsonb_build_array(p_payment.snapshot);
  p_outcome.accounts_by_student := p_outcome.accounts_by_student || jsonb_build_object(
    p_student_id, merge_account_change(p_outcome.accounts_by_student->p_student_id, entry.account_change)
  );
  p_outcome.paid := p_outcome.paid || jsonb_build_array(p_paid || jsonb_build_object(
    'transaction_id', entry.transaction_id, 'amount', p_payment.snapshot->'amount'
  ));
  RETURN p_outcome;
END;
$$;
