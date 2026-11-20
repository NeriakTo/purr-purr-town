CREATE FUNCTION ppt.operation_definition(p_type jsonb)
RETURNS TABLE (roles text[], expect_mode text)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT definition.roles, definition.expect_mode
  FROM (VALUES
    ('"op.undo"'::jsonb, ARRAY['teacher', 'agent'], 'forbidden'),
    ('"tx.reverse"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"tx.correct"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"points.apply_rule"'::jsonb, ARRAY['teacher', 'agent'], 'forbidden'),
    ('"points.adjust"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"setting.set"'::jsonb, ARRAY['teacher'], 'required'),
    ('"product.save"'::jsonb, ARRAY['teacher'], 'required'),
    ('"product.retire"'::jsonb, ARRAY['teacher'], 'required'),
    ('"inventory.use"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"shop.purchase"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"submission.set_status"'::jsonb, ARRAY['teacher', 'agent'], 'required'),
    ('"submission.propose"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"legacy_effect.resolve"'::jsonb, ARRAY['teacher'], 'required'),
    ('"confirmation.confirm"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"confirmation.reject"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"correction.require"'::jsonb, ARRAY['teacher', 'agent'], 'forbidden'),
    ('"correction.mark_returned"'::jsonb, ARRAY['teacher', 'agent'], 'required'),
    ('"correction.confirm"'::jsonb, ARRAY['teacher'], 'required'),
    ('"correction.redo"'::jsonb, ARRAY['teacher'], 'required'),
    ('"correction.cancel"'::jsonb, ARRAY['teacher'], 'required'),
    ('"correction.set_due"'::jsonb, ARRAY['teacher'], 'required'),
    ('"schedule.correction_overdue"'::jsonb, ARRAY['scheduler'], 'forbidden'),
    ('"rule.save"'::jsonb, ARRAY['teacher'], 'required'),
    ('"rule.retire"'::jsonb, ARRAY['teacher'], 'required'),
    ('"task.create"'::jsonb, ARRAY['teacher'], 'forbidden'),
    ('"task.update"'::jsonb, ARRAY['teacher'], 'required'),
    ('"task.void"'::jsonb, ARRAY['teacher'], 'required'),
    ('"task.restore"'::jsonb, ARRAY['teacher'], 'required')
  ) AS definition(type, roles, expect_mode)
  WHERE definition.type = p_type;
$$;

CREATE FUNCTION ppt.is_json_object(p_value jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_typeof(p_value) IS NOT DISTINCT FROM 'object';
$$;

CREATE FUNCTION ppt.has_nonempty_string(p_value jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_typeof(p_value->p_key) IS NOT DISTINCT FROM 'string' AND p_value->>p_key <> '';
$$;

CREATE FUNCTION ppt.has_only_keys(p_value jsonb, p_keys text[])
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN is_json_object(p_value) THEN p_value - p_keys = '{}'::jsonb ELSE false END;
$$;

CREATE FUNCTION ppt.validate_operation_expect(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  CASE (SELECT expect_mode FROM operation_definition(p_op->'type'))
    WHEN 'forbidden' THEN
      IF p_op ? 'expect' THEN
        PERFORM reject_operation('INVALID_PAYLOAD');
      END IF;
    WHEN 'required' THEN
      PERFORM validate_version_condition(p_op->'expect');
    ELSE RAISE EXCEPTION '已知操作缺少版本條件定義';
  END CASE;
END;
$$;
