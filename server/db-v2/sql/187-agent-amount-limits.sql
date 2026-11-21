CREATE FUNCTION ppt.agent_daily_limit_exceeded(
  p_class_id text, p_receipts jsonb, p_today date, p_max integer
)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  WITH affected AS (
    SELECT DISTINCT tx.student_id
    FROM jsonb_each(p_receipts) AS r(op_id, receipt)
    JOIN operations AS op ON op.op_id = r.op_id AND op.class_id = p_class_id
    JOIN transactions AS tx ON tx.class_id = op.class_id AND tx.op_id = op.op_id
    WHERE r.receipt->>'status' = 'committed' AND r.receipt->'replayed' = 'false'::jsonb
      AND op.type <> 'op.undo' AND (tx.occurred_at AT TIME ZONE 'Asia/Taipei')::date = p_today
  )
  SELECT EXISTS (
    SELECT 1 FROM affected
    JOIN transactions AS tx ON tx.class_id = p_class_id AND tx.student_id = affected.student_id
    JOIN operations AS op ON op.class_id = tx.class_id AND op.op_id = tx.op_id
    WHERE op.actor_kind = 'agent' AND op.type <> 'op.undo'
      AND NOT agent_batch_was_held(p_class_id, op.batch_id)
      AND (tx.occurred_at AT TIME ZONE 'Asia/Taipei')::date = p_today
    GROUP BY tx.student_id HAVING sum(abs(tx.amount)) > p_max
  );
$$;

CREATE FUNCTION ppt.agent_amount_limit_reason(
  p_class_id text, p_receipts jsonb, p_time timestamptz, p_limits ppt.agent_limits
)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_receipts) AS r(op_id, receipt)
    JOIN transactions AS tx ON tx.class_id = p_class_id AND tx.op_id = r.op_id
    WHERE r.receipt->>'status' = 'committed' AND r.receipt->'replayed' = 'false'::jsonb
      AND abs(tx.amount) > p_limits.max_points_per_tx
  ) THEN
    RETURN 'max_points_per_tx';
  END IF;
  IF agent_daily_limit_exceeded(
    p_class_id, p_receipts, (p_time AT TIME ZONE 'Asia/Taipei')::date, p_limits.max_points_per_student_per_day
  ) THEN
    RETURN 'max_points_per_student_per_day';
  END IF;
  RETURN NULL;
END;
$$;
