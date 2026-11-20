CREATE FUNCTION ppt.validate_correction_overdue(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['date']) OR NOT valid_calendar_day(p_payload->'date') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.apply_correction_overdue(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT (operation_result(p_noop => true), '[]'::jsonb, '[]'::jsonb)::operation_outcome;
$$;
