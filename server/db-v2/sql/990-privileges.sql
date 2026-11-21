REVOKE ALL ON SCHEMA ppt, ppt_agent FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ppt, ppt_agent FROM PUBLIC;

DO $$
DECLARE
  app_type record;
BEGIN
  FOR app_type IN
    SELECT n.nspname, t.typname
    FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_class AS c ON c.oid = t.typrelid
    WHERE n.nspname IN ('ppt', 'ppt_agent')
      AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND c.relkind = 'c'))
  LOOP
    EXECUTE pg_catalog.format('REVOKE USAGE ON TYPE %I.%I FROM PUBLIC', app_type.nspname, app_type.typname);
  END LOOP;
END;
$$;

ALTER FUNCTION ppt.submit_operation(jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION ppt.cancel_operation(text, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION ppt_agent.agent_submit(text, text, jsonb, text) SECURITY DEFINER;

GRANT USAGE ON SCHEMA ppt TO ppt_web, ppt_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA ppt TO ppt_web, ppt_backup;
GRANT EXECUTE ON FUNCTION ppt.submit_operation(jsonb, jsonb),
  ppt.cancel_operation(text, text, jsonb) TO ppt_web;
GRANT EXECUTE ON FUNCTION ppt.can_access_class(text, jsonb) TO ppt_web;
GRANT EXECUTE ON FUNCTION ppt.system_actor() TO ppt_web;

GRANT USAGE ON SCHEMA ppt_agent TO ppt_agent, ppt_backup;
GRANT EXECUTE ON FUNCTION ppt_agent.agent_submit(text, text, jsonb, text) TO ppt_agent;
GRANT EXECUTE ON FUNCTION ppt_agent.mask_student_names(text, jsonb) TO ppt_agent;
