CREATE FUNCTION ppt.is_bounded_integer(p_value jsonb, p_min numeric, p_max numeric)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN
    p_value::numeric BETWEEN p_min AND p_max AND p_value::numeric = trunc(p_value::numeric)
  ELSE false END;
$$;

CREATE FUNCTION ppt.validate_points_apply_rule(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['student_id', 'rule_id', 'rule_version'])
      OR NOT has_nonempty_string(p_payload, 'student_id')
      OR NOT has_nonempty_string(p_payload, 'rule_id')
      OR NOT is_bounded_integer(p_payload->'rule_version', 1, 2147483647) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.require_manual_rule_version(p_op jsonb, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  enrollment text;
  rule rules;
  version_amount numeric;
BEGIN
  SELECT enrollment_status INTO enrollment FROM students
  WHERE class_id = class_key AND student_id = payload->>'student_id';
  SELECT * INTO rule FROM rules WHERE class_id = class_key AND rule_id = payload->>'rule_id';
  IF enrollment IS NULL OR rule.rule_id IS NULL THEN
    IF p_actor->>'kind' = 'agent' THEN
      PERFORM reject_operation('SCOPE_FORBIDDEN');
    END IF;
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF enrollment IN ('transferred', 'archived') OR rule.disabled THEN
    PERFORM reject_operation('ENTITY_INACTIVE');
  END IF;
  IF rule.kind <> 'manual' THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF rule.rev <> (payload->'rule_version')::numeric THEN
    SELECT amount INTO STRICT version_amount FROM rule_versions
    WHERE class_id = class_key AND rule_id = rule.rule_id AND rev = rule.rev;
    PERFORM reject_operation('RULE_VERSION_STALE',
      jsonb_build_object('rev', rule.rev, 'value', jsonb_build_object('amount', version_amount)));
  END IF;
END;
$$;

CREATE FUNCTION ppt.rule_repeat_warnings(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
  SELECT coalesce((
    SELECT jsonb_build_array(jsonb_build_object(
      'code', 'POSSIBLE_DUPLICATE', 'student_id', tx.student_id, 'rule_id', tx.rule_id,
      'prior_op_id', op.op_id, 'prior_actor_kind', op.actor_kind, 'prior_at', tx.occurred_at
    ))
    FROM transactions AS tx JOIN operations AS op USING (class_id, op_id)
    WHERE tx.class_id = p_op->>'class_id' AND tx.student_id = p_op->'payload'->>'student_id'
      AND tx.kind = 'adjust' AND tx.rule_id = p_op->'payload'->>'rule_id'
      AND tx.occurred_at BETWEEN p_time - interval '10 minutes' AND p_time
      AND (op.actor_kind, op.actor_id) IS DISTINCT FROM (p_actor->>'kind', p_actor->>'id')
    ORDER BY tx.occurred_at DESC, tx.transaction_id
    LIMIT 1
  ), '[]'::jsonb);
$$;

CREATE FUNCTION ppt.apply_points_rule(p_op jsonb, p_actor jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  warnings jsonb := rule_repeat_warnings(p_op, p_actor, p_time);
  version rule_versions;
  entry ledger_entry;
BEGIN
  SELECT * INTO STRICT version FROM rule_versions
  WHERE class_id = class_key AND rule_id = payload->>'rule_id' AND rev = (payload->'rule_version')::integer;
  entry := append_account_transaction(
    class_key, payload->>'student_id', p_op->>'op_id', 'adjust', version.amount, version.amount,
    p_time, p_time, version.name, p_rule_id => version.rule_id, p_rule_rev => version.rev
  );
  RETURN (operation_result(jsonb_build_array(entry.transaction_id)),
    jsonb_build_array(entry.account_change), warnings)::operation_outcome;
END;
$$;
