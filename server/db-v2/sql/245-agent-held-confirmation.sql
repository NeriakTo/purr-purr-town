CREATE FUNCTION ppt.require_held_agent_inputs(p_target ppt.confirmations, p_actor jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  batch agent_calls;
BEGIN
  SELECT * INTO batch FROM agent_calls
  WHERE call_id = p_target.batch_id AND class_id = p_target.class_id;
  IF NOT FOUND
    OR batch.held_inputs IS NULL
    OR batch.held_inputs->0->>'op_id' IS DISTINCT FROM p_target.created_op_id THEN
    RAISE EXCEPTION '小野暫緩批次的輸入資料不完整';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT op_id, row_number() OVER (ORDER BY entry_order) AS position
      FROM agent_batch_members(batch)
    ) AS member
    FULL JOIN jsonb_array_elements(batch.held_inputs) WITH ORDINALITY AS saved(input, position) USING (position)
    LEFT JOIN operations AS op ON op.op_id = member.op_id
    WHERE saved.input->>'op_id' IS DISTINCT FROM member.op_id
      OR saved.input->'class_id' IS DISTINCT FROM to_jsonb(batch.class_id)
      OR saved.input->'batch_id' IS DISTINCT FROM to_jsonb(batch.call_id)
      OR op.status IS DISTINCT FROM 'held'
      OR op.batch_id IS DISTINCT FROM batch.call_id
      OR same_operation_actor(op, batch.class_id, p_actor) IS NOT TRUE
      OR op.content_hash IS DISTINCT FROM operation_content_hash(saved.input)
  ) THEN
    RAISE EXCEPTION '小野暫緩批次的成員資料不完整';
  END IF;
  RETURN batch.held_inputs;
END;
$$;

CREATE FUNCTION ppt.held_agent_rule_outdated(p_op jsonb, p_held_at timestamptz)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT p_op->'type' = '"points.apply_rule"'::jsonb
    AND jsonb_typeof(p_op->'payload'->'student_id') = 'string'
    AND jsonb_typeof(p_op->'payload'->'rule_id') = 'string'
    AND EXISTS (
      SELECT 1 FROM transactions
      WHERE class_id = p_op->>'class_id'
        AND student_id = p_op->'payload'->>'student_id'
        AND rule_id = p_op->'payload'->>'rule_id'
        AND kind = 'adjust' AND occurred_at >= p_held_at
    );
$$;

CREATE FUNCTION ppt.resolve_held_agent_operation(
  p_op jsonb, p_actor jsonb, p_status ppt.confirmation_status, p_held_at timestamptz, p_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  receipt jsonb;
BEGIN
  IF p_status = 'rejected' THEN
    receipt := operation_receipt(p_op->>'op_id', 'rejected', 'CONFIRMATION_REJECTED');
  ELSIF held_agent_rule_outdated(p_op, p_held_at) THEN
    receipt := operation_receipt(p_op->>'op_id', 'rejected', 'HELD_OP_OUTDATED');
  ELSE
    receipt := execute_claimed_operation(p_op, p_actor, p_time);
  END IF;
  PERFORM save_operation_receipt(receipt);
  RETURN jsonb_build_object('op_id', receipt->'op_id', 'status', receipt->'status', 'code', receipt->'code');
END;
$$;

CREATE FUNCTION ppt.apply_held_agent_confirmation(
  p_target ppt.confirmations, p_status ppt.confirmation_status, p_op_id text, p_time timestamptz
)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  actor jsonb := agent_actor();
  inputs jsonb := require_held_agent_inputs(p_target, actor);
  op jsonb;
  items jsonb := '[]';
  change jsonb;
BEGIN
  FOR op IN SELECT value FROM jsonb_array_elements(inputs) WITH ORDINALITY ORDER BY ordinality
  LOOP
    items := items || jsonb_build_array(
      resolve_held_agent_operation(op, actor, p_status, p_target.created_at, p_time)
    );
  END LOOP;
  change := store_confirmation_status(p_target, p_status, p_op_id, p_time);
  RETURN (
    operation_result() || jsonb_build_object('held', jsonb_build_object(
      'batch_id', p_target.batch_id, 'items', items
    )), jsonb_build_array(change), '[]'::jsonb
  )::operation_outcome;
END;
$$;
