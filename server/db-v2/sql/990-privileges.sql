REVOKE ALL ON SCHEMA ppt, ppt_agent FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ppt, ppt_agent FROM PUBLIC;

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
