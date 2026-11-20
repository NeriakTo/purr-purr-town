CREATE FUNCTION ppt.validate_version_condition(p_expect jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  version numeric;
BEGIN
  IF jsonb_typeof(p_expect) = 'object' THEN
    IF p_expect - 'rev' = '{}'::jsonb AND jsonb_typeof(p_expect->'rev') = 'number' THEN
      version := (p_expect->>'rev')::numeric;
      IF version >= 0 AND version = trunc(version) THEN
        RETURN;
      END IF;
    ELSIF p_expect - 'after_op' = '{}'::jsonb AND jsonb_typeof(p_expect->'after_op') = 'string'
      AND p_expect->>'after_op' <> '' THEN
      RETURN;
    END IF;
  END IF;
  PERFORM reject_operation('INVALID_PAYLOAD');
END;
$$;

CREATE FUNCTION ppt.operation_entity_revision(
  p_class_id text, p_op_id text, p_entity text, p_key jsonb
)
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT (entry->>'rev')::integer
  FROM operations AS op CROSS JOIN LATERAL jsonb_array_elements(op.receipt->'changes') AS entry
  WHERE op.class_id = p_class_id AND op.op_id = p_op_id AND op.status = 'committed'
    AND entry->>'entity' = p_entity AND entry->'key' = p_key;
$$;

CREATE FUNCTION ppt.matches_version_condition(
  p_class_id text, p_expect jsonb, p_entity text, p_key jsonb, p_rev integer, p_allow_zero boolean
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  expected_rev numeric;
BEGIN
  IF p_expect ? 'rev' THEN
    expected_rev := (p_expect->>'rev')::numeric;
    IF expected_rev = 0 THEN
      RETURN p_allow_zero;
    END IF;
  ELSE
    expected_rev := operation_entity_revision(p_class_id, p_expect->>'after_op', p_entity, p_key);
  END IF;
  RETURN coalesce(p_rev = expected_rev, false);
END;
$$;

CREATE FUNCTION ppt.current_entity_revision(
  p_class_id text, p_last_op_id text, p_rev integer, p_value jsonb
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
  SELECT jsonb_build_object(
    'value', p_value, 'rev', coalesce(p_rev, 0), 'last_op_id', p_last_op_id,
    'actor', CASE WHEN op.op_id IS NOT NULL THEN jsonb_build_object('kind', op.actor_kind, 'id', op.actor_id) END,
    'committed_at', op.committed_at
  )
  FROM (VALUES (p_class_id, p_last_op_id)) AS target(class_id, op_id)
  LEFT JOIN operations AS op ON op.class_id = target.class_id AND op.op_id = target.op_id;
$$;
