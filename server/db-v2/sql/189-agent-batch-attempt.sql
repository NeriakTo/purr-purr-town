CREATE TYPE ppt.agent_batch_attempt AS (receipts jsonb, held_reason text);

CREATE FUNCTION ppt.try_agent_batch(
  p_class_id text, p_ops jsonb, p_actor jsonb, p_time timestamptz, p_limits ppt.agent_limits
)
RETURNS ppt.agent_batch_attempt
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  receipts jsonb;
  reason text;
BEGIN
  IF p_ops = '[]'::jsonb THEN
    RETURN ('{}'::jsonb, NULL)::agent_batch_attempt;
  END IF;

  reason := agent_input_limit_reason(p_class_id, p_ops, p_time, p_limits);
  IF reason IS NOT NULL THEN
    RETURN (NULL, reason)::agent_batch_attempt;
  END IF;

  BEGIN
    receipts := execute_new_agent_operations(p_ops, p_actor);
    reason := agent_amount_limit_reason(p_class_id, receipts, p_time, p_limits);
    IF reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P604H', MESSAGE = reason;
    END IF;
    RETURN (receipts, NULL)::agent_batch_attempt;
  EXCEPTION WHEN SQLSTATE 'P604H' THEN
    GET STACKED DIAGNOSTICS reason = MESSAGE_TEXT;
    RETURN (NULL, reason)::agent_batch_attempt;
  END;
END;
$$;
