CREATE FUNCTION ppt.job_key(p_job_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('job_id', p_job_id);
$$;

CREATE FUNCTION ppt.job_value(p_job ppt.jobs)
RETURNS jsonb
LANGUAGE sql STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'title', p_job.title, 'salary', p_job.salary, 'icon', p_job.icon, 'cycle', p_job.cycle,
    'category', p_job.category, 'disabled', p_job.disabled, 'assignee_ids', p_job.assignee_ids
  );
$$;

CREATE FUNCTION ppt.require_job_students(p_class_id text, p_student_ids jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_student_ids) AS assignee(student_id)
    LEFT JOIN students AS student ON student.class_id = p_class_id AND student.student_id = assignee.student_id
    WHERE student.student_id IS NULL
  ) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
END;
$$;

CREATE FUNCTION ppt.validate_job_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
BEGIN
  IF NOT has_nonempty_string(payload, 'job_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  CASE p_op->>'type'
    WHEN 'job.save' THEN
      IF NOT has_only_keys(payload, ARRAY['job_id', 'title', 'salary', 'cycle', 'icon', 'category'])
        OR NOT has_nonempty_string(payload, 'title') OR char_length(payload->>'title') > 100
        OR NOT is_bounded_integer(payload->'salary', 0, 100000)
        OR NOT has_nonempty_string(payload, 'cycle')
        OR payload->>'cycle' NOT IN ('daily', 'weekly', 'monthly', 'semester', 'once')
        OR (payload ? 'icon' AND jsonb_typeof(payload->'icon') <> 'string')
        OR (payload ? 'category' AND jsonb_typeof(payload->'category') <> 'string') THEN
        PERFORM reject_operation('INVALID_PAYLOAD');
      END IF;
    WHEN 'job.retire' THEN
      IF NOT has_only_keys(payload, ARRAY['job_id']) THEN
        PERFORM reject_operation('INVALID_PAYLOAD');
      END IF;
    WHEN 'job.set_assignees' THEN
      IF NOT has_only_keys(payload, ARRAY['job_id', 'student_ids']) THEN
        PERFORM reject_operation('INVALID_PAYLOAD');
      END IF;
      PERFORM validate_task_assignee_list(payload->'student_ids', true);
  END CASE;
END;
$$;

CREATE FUNCTION ppt.require_job_operation(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  id text := p_op->'payload'->>'job_id';
  job jobs;
  is_new boolean;
BEGIN
  SELECT * INTO job FROM jobs WHERE class_id = p_op->>'class_id' AND job_id = id;
  is_new := NOT FOUND;
  IF is_new AND p_op->>'type' <> 'job.save' THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF p_op->>'type' = 'job.set_assignees' THEN
    PERFORM require_job_students(job.class_id, p_op->'payload'->'student_ids');
    IF job.disabled THEN
      PERFORM reject_operation('ENTITY_INACTIVE');
    END IF;
  END IF;

  PERFORM require_version_condition(p_op, 'job', job_key(id), job.rev, job.last_op_id,
    CASE WHEN NOT is_new THEN job_value(job) END, is_new);
  IF is_new AND NOT valid_v4_op_id(id) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_job(p_job ppt.jobs, p_op_id text)
RETURNS ppt.jobs
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  INSERT INTO jobs AS target (class_id, job_id, title, salary, icon, cycle, category, disabled, assignee_ids, last_op_id)
  VALUES (p_job.class_id, p_job.job_id, p_job.title, p_job.salary, p_job.icon, p_job.cycle, p_job.category,
    p_job.disabled, p_job.assignee_ids, p_op_id)
  ON CONFLICT (class_id, job_id) DO UPDATE
  SET title = excluded.title, salary = excluded.salary, icon = excluded.icon, cycle = excluded.cycle,
      category = excluded.category, disabled = excluded.disabled, assignee_ids = excluded.assignee_ids,
      rev = target.rev + 1, last_op_id = excluded.last_op_id
  RETURNING target.*;
$$;

CREATE FUNCTION ppt.apply_job_operation(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  id text := payload->>'job_id';
  previous jobs;
  target jobs;
  previous_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM jobs WHERE class_id = class_key AND job_id = id;
  IF FOUND THEN
    previous_value := job_value(previous);
  END IF;
  target := previous;

  CASE p_op->>'type'
    WHEN 'job.save' THEN
      target := jsonb_populate_record(NULL::jobs, payload);
      target.class_id := class_key;
      target.assignee_ids := coalesce(previous.assignee_ids, '[]'::jsonb);
      target.disabled := false;
    WHEN 'job.retire' THEN target.disabled := true;
    WHEN 'job.set_assignees' THEN target.assignee_ids := payload->'student_ids';
  END CASE;

  unchanged := job_value(target) IS NOT DISTINCT FROM previous_value;
  IF unchanged THEN
    target := previous;
  ELSE
    target := store_job(target, p_op->>'op_id');
  END IF;

  RETURN (operation_result(p_noop => unchanged), jsonb_build_array(entity_change(
    'job', job_key(id), coalesce(previous.rev, 0), target.rev, target.last_op_id,
    previous_value, job_value(target)
  )), '[]'::jsonb)::operation_outcome;
END;
$$;
