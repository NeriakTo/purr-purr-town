CREATE FUNCTION ppt.require_duty_job_setting(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  disabled_job boolean;
BEGIN
  IF payload->>'key' <> 'dutyJobId' OR payload->'value' = 'null'::jsonb THEN
    RETURN;
  END IF;
  SELECT disabled INTO disabled_job FROM jobs
  WHERE class_id = p_op->>'class_id' AND job_id = payload->>'value';
  IF NOT FOUND THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF disabled_job THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.duty_job_id(p_class_id text)
RETURNS text
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT value #>> '{}' FROM settings_entries WHERE class_id = p_class_id AND key = 'dutyJobId';
$$;

CREATE FUNCTION ppt.apply_job_retirement(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  id text := p_op->'payload'->>'job_id';
  outcome operation_outcome := apply_job_operation(p_op);
  cleared operation_outcome;
BEGIN
  IF duty_job_id(class_key) = id THEN
    cleared := apply_setting_set(p_op || jsonb_build_object(
      'payload', jsonb_build_object('key', 'dutyJobId', 'value', NULL)
    ));
    outcome.changes := outcome.changes || cleared.changes;
    outcome.result := outcome.result || jsonb_build_object('noop', false);
  END IF;
  RETURN outcome;
END;
$$;
