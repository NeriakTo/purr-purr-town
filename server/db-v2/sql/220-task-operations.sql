CREATE FUNCTION ppt.task_value(p_task ppt.tasks)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
SET datestyle = 'ISO, YMD'
AS $$
  SELECT jsonb_build_object(
    'title', p_task.title, 'task_type', p_task.task_type, 'page_text', p_task.page_text,
    'published_on', p_task.published_on, 'due_on', p_task.due_on, 'semester', p_task.semester, 'voided', p_task.voided
  );
$$;

CREATE FUNCTION ppt.require_task(p_class_id text, p_task_id text)
RETURNS ppt.tasks
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  task tasks;
BEGIN
  SELECT * INTO task FROM tasks WHERE class_id = p_class_id AND task_id = p_task_id;
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  RETURN task;
END;
$$;

CREATE FUNCTION ppt.require_task_create_targets(p_task ppt.tasks, p_assignees jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_assignees IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_assignees) AS assignee(student_id)
      LEFT JOIN students AS student ON student.class_id = p_task.class_id AND student.student_id = assignee.student_id
      WHERE student.student_id IS NULL
    ) THEN
      PERFORM reject_operation('NOT_FOUND');
    END IF;
    IF EXISTS (
      SELECT 1 FROM students
      WHERE class_id = p_task.class_id AND p_assignees ? student_id
        AND enrollment_status IN ('transferred', 'archived')
    ) THEN
      PERFORM reject_operation('ENTITY_INACTIVE');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE class_id = p_task.class_id AND task_id = p_task.task_id) THEN
    PERFORM reject_operation('ID_CONFLICT');
  END IF;
END;
$$;

CREATE FUNCTION ppt.is_task_exempt(p_task ppt.tasks, p_rules jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rules) AS item(rule)
    WHERE rule->>'keyword' <> '' AND rule->>'taskType' = p_task.task_type
      AND strpos(lower(p_task.title), lower(rule->>'keyword')) > 0
  );
$$;

CREATE FUNCTION ppt.create_task_submissions(p_task ppt.tasks, p_assignees jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  WITH roster AS (
    SELECT student_id, seat_number, exempt_rules FROM students
    WHERE class_id = p_task.class_id
      AND CASE WHEN p_assignees IS NULL THEN enrollment_status = 'enrolled'
               ELSE p_assignees ? student_id END
  ), created AS (
    INSERT INTO submissions (class_id, task_id, student_id, status, last_op_id)
    SELECT p_task.class_id, p_task.task_id, student_id,
      CASE WHEN is_task_exempt(p_task, exempt_rules) THEN 'exempt'::submission_status ELSE 'pending' END,
      p_task.last_op_id
    FROM roster
    RETURNING *
  )
  SELECT coalesce(jsonb_agg(
    submission_change(NULL, created, jsonb_build_object('task_id', created.task_id, 'student_id', created.student_id),
      p_task.last_op_id)
    ORDER BY roster.seat_number, created.student_id COLLATE "C"
  ), '[]'::jsonb)
  FROM created JOIN roster USING (student_id);
$$;

CREATE FUNCTION ppt.apply_task_create(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  assignees jsonb := payload->'assignee_ids';
  task tasks := jsonb_populate_record(NULL::tasks, payload);
  task_change jsonb;
BEGIN
  task.class_id := p_op->>'class_id';
  task.semester := semester_at(task.published_on);
  task.last_op_id := p_op->>'op_id';
  PERFORM require_task_create_targets(task, assignees);

  INSERT INTO tasks (class_id, task_id, title, task_type, page_text, published_on, due_on, semester, last_op_id)
  VALUES (task.class_id, task.task_id, task.title, task.task_type, task.page_text,
    task.published_on, task.due_on, task.semester, task.last_op_id)
  RETURNING * INTO task;

  task_change := entity_change('task', jsonb_build_object('task_id', task.task_id),
    0, task.rev, task.last_op_id, NULL, task_value(task));
  RETURN (
    operation_result(), jsonb_build_array(task_change) || create_task_submissions(task, assignees), '[]'::jsonb
  )::operation_outcome;
END;
$$;

CREATE FUNCTION ppt.require_task_update_version(p_op jsonb, p_task ppt.tasks, p_key jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_task.voided THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;
  PERFORM require_version_condition(p_op, 'task', p_key, p_task.rev, p_task.last_op_id, task_value(p_task));
END;
$$;

CREATE FUNCTION ppt.apply_task_update(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  previous tasks := require_task(p_op->>'class_id', payload->>'task_id');
  entity_key jsonb := jsonb_build_object('task_id', previous.task_id);
  updated tasks := jsonb_populate_record(previous, payload);
  old_fields jsonb;
  new_fields jsonb;
  unchanged boolean;
BEGIN
  PERFORM require_task_update_version(p_op, previous, entity_key);

  SELECT jsonb_object_agg(key, old_value), jsonb_object_agg(key, new_value)
  INTO old_fields, new_fields
  FROM jsonb_each(task_value(previous)) AS before_fields(key, old_value)
  JOIN jsonb_each(task_value(updated)) AS after_fields(key, new_value) USING (key)
  WHERE old_value IS DISTINCT FROM new_value;

  unchanged := new_fields IS NULL;
  IF unchanged THEN
    SELECT jsonb_object_agg(key, value) INTO new_fields
    FROM jsonb_each(task_value(previous))
    WHERE payload ? key;
    old_fields := new_fields;
  ELSE
    UPDATE tasks
    SET title = updated.title, task_type = updated.task_type, page_text = updated.page_text,
        due_on = updated.due_on, rev = rev + 1, last_op_id = op_key
    WHERE class_id = previous.class_id AND task_id = previous.task_id
    RETURNING * INTO updated;
  END IF;

  RETURN (
    operation_result(p_noop => unchanged),
    jsonb_build_array(entity_change('task', entity_key, previous.rev, updated.rev, op_key, old_fields, new_fields)),
    '[]'::jsonb
  )::operation_outcome;
END;
$$;
