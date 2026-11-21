CREATE SCHEMA ppt_agent;

CREATE FUNCTION ppt_agent.agent_submit(class_id text, call_id text, ops jsonb, note text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT ppt.agent_submit($1, $2, $3, $4);
$$;
