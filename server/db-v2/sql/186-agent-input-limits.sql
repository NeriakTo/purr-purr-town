CREATE TYPE ppt.agent_limits AS (
  max_students_per_call integer,
  max_students_per_10min integer,
  max_points_per_tx integer,
  max_points_per_student_per_day integer,
  max_pending_held integer
);

CREATE FUNCTION ppt.load_agent_limits(p_class_id text)
RETURNS ppt.agent_limits
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce((
    SELECT (
      (value->'max_students_per_call')::numeric::integer,
      (value->'max_students_per_10min')::numeric::integer,
      (value->'max_points_per_tx')::numeric::integer,
      (value->'max_points_per_student_per_day')::numeric::integer,
      (value->'max_pending_held')::numeric::integer
    )::agent_limits
    FROM settings_entries WHERE class_id = p_class_id AND key = 'agentLimits'
  ), (5, 10, 200, 300, 5)::agent_limits);
$$;

CREATE FUNCTION ppt.agent_operation_student(p_class_id text, p_type text, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  original operations;
BEGIN
  IF jsonb_typeof(p_payload->'student_id') = 'string' THEN
    RETURN p_payload->>'student_id';
  ELSIF p_type = 'correction.mark_returned' THEN
    RETURN (SELECT student_id FROM corrections
      WHERE class_id = p_class_id AND correction_id = p_payload->>'correction_id');
  ELSIF p_type = 'op.undo' THEN
    SELECT * INTO original FROM operations
    WHERE class_id = p_class_id AND op_id = p_payload->>'target_op_id'
      AND actor_kind = 'agent' AND actor_id = agent_actor()->>'id' AND type <> 'op.undo';
    IF FOUND THEN
      RETURN agent_operation_student(p_class_id, original.type, original.payload);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION ppt.recent_agent_students(p_class_id text, p_after timestamptz)
RETURNS SETOF text
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT agent_operation_student(p_class_id, op.type, op.payload)
  FROM operations AS op
  WHERE op.class_id = p_class_id AND op.actor_kind = 'agent' AND op.status = 'committed'
    AND op.committed_at > p_after AND NOT agent_batch_was_held(p_class_id, op.batch_id)
  UNION
  SELECT agent_operation_student(p_class_id, op.type, op.payload)
  FROM agent_pending_operations(p_class_id, p_after) AS op;
$$;

CREATE FUNCTION ppt.agent_rule_targets(p_ops jsonb)
RETURNS TABLE (student_id text, rule_id text)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT op->'payload'->>'student_id', op->'payload'->>'rule_id'
  FROM jsonb_array_elements(p_ops) AS input(op)
  WHERE op->>'type' = 'points.apply_rule'
    AND jsonb_typeof(op->'payload'->'student_id') = 'string'
    AND jsonb_typeof(op->'payload'->'rule_id') = 'string';
$$;

CREATE FUNCTION ppt.agent_rule_already_applied(
  p_class_id text, p_ops jsonb, p_today date
)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agent_rule_targets(p_ops) AS target
    WHERE EXISTS (
      SELECT 1 FROM transactions AS tx
      WHERE tx.class_id = p_class_id AND tx.kind = 'adjust'
        AND tx.student_id = target.student_id AND tx.rule_id = target.rule_id
        AND (tx.occurred_at AT TIME ZONE 'Asia/Taipei')::date = p_today
    ) OR EXISTS (
      SELECT 1 FROM agent_pending_operations(p_class_id) AS pending
      WHERE pending.type = 'points.apply_rule'
        AND pending.payload->'student_id' = to_jsonb(target.student_id)
        AND pending.payload->'rule_id' = to_jsonb(target.rule_id)
    )
  );
$$;

CREATE FUNCTION ppt.agent_input_limit_reason(
  p_class_id text, p_ops jsonb, p_time timestamptz, p_limits ppt.agent_limits
)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  students text[];
  since timestamptz := p_time - interval '10 minutes';
  today date := (p_time AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT student FROM jsonb_array_elements(p_ops) AS input(op)
    CROSS JOIN LATERAL agent_operation_student(p_class_id, op->>'type', op->'payload') AS student
    WHERE student IS NOT NULL
  ) INTO students;

  IF cardinality(students) > p_limits.max_students_per_call THEN
    RETURN 'max_students_per_call';
  END IF;
  IF (SELECT count(DISTINCT student) FROM (
      SELECT unnest(students) AS student
      UNION ALL SELECT recent_agent_students(p_class_id, since)
    ) AS candidates) > p_limits.max_students_per_10min THEN
    RETURN 'max_students_per_10min';
  END IF;
  IF agent_rule_already_applied(p_class_id, p_ops, today) THEN
    RETURN 'rule_applied_today';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_rule_targets(p_ops) GROUP BY student_id, rule_id HAVING count(*) > 1) THEN
    RETURN 'duplicate_rule_in_call';
  END IF;
  RETURN NULL;
END;
$$;
