CREATE FUNCTION ppt.validate_rule_save(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  amount numeric;
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['rule_id', 'kind', 'event', 'name', 'amount', 'icon', 'category'])
    OR NOT has_nonempty_string(p_payload, 'rule_id')
    OR NOT has_nonempty_string(p_payload, 'kind')
    OR p_payload->>'kind' NOT IN ('manual', 'event')
    OR NOT has_nonempty_string(p_payload, 'name')
    OR char_length(p_payload->>'name') > 100
    OR jsonb_typeof(p_payload->'amount') IS DISTINCT FROM 'number'
    OR (p_payload ? 'icon' AND jsonb_typeof(p_payload->'icon') <> 'string')
    OR (p_payload ? 'category' AND jsonb_typeof(p_payload->'category') <> 'string') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;

  amount := (p_payload->>'amount')::numeric;
  IF abs(amount) > 100000 OR amount <> trunc(amount)
    OR (p_payload->>'kind' = 'manual' AND p_payload ? 'event')
    OR (p_payload->>'kind' = 'event' AND (
      NOT has_nonempty_string(p_payload, 'event')
      OR p_payload->>'event' NOT IN (
        'submission.late', 'submission.missing', 'daily_quest.complete',
        'correction.confirmed', 'correction.overdue'
      )
    )) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.validate_rule_retire(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['rule_id']) OR NOT has_nonempty_string(p_payload, 'rule_id') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.rule_value(p_rule ppt.rules, p_version ppt.rule_versions)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_rule.rev IS NOT NULL THEN jsonb_build_object(
    'kind', p_rule.kind, 'event', p_rule.event, 'disabled', p_rule.disabled,
    'name', p_version.name, 'amount', p_version.amount, 'icon', p_version.icon, 'category', p_version.category
  ) END;
$$;

CREATE FUNCTION ppt.require_rule_save_terms(p_before ppt.rules, p_after ppt.rules)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_before.rev IS NULL AND NOT valid_v4_op_id(p_after.rule_id) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF p_before.rev IS NOT NULL AND (
    p_before.kind <> p_after.kind OR p_before.event IS DISTINCT FROM p_after.event
  ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  IF p_after.kind = 'event' AND (p_before.rev IS NULL OR p_before.disabled) AND EXISTS (
    SELECT 1 FROM rules
    WHERE class_id = p_after.class_id AND kind = 'event' AND event = p_after.event
      AND NOT disabled AND rule_id <> p_after.rule_id
  ) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_rule_version(p_rule ppt.rules, p_version ppt.rule_versions)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  INSERT INTO rules (class_id, rule_id, kind, event, disabled, rev, last_op_id)
  VALUES (p_rule.class_id, p_rule.rule_id, p_rule.kind, p_rule.event, p_rule.disabled, p_rule.rev, p_rule.last_op_id)
  ON CONFLICT (class_id, rule_id) DO UPDATE
  SET disabled = excluded.disabled, rev = excluded.rev, last_op_id = excluded.last_op_id;

  INSERT INTO rule_versions (class_id, rule_id, rev, name, amount, icon, category, effective_at)
  VALUES (p_rule.class_id, p_rule.rule_id, p_rule.rev, p_version.name, p_version.amount,
    p_version.icon, p_version.category, p_version.effective_at);
END;
$$;

CREATE FUNCTION ppt.require_rule_target(
  p_op jsonb, p_rule ppt.rules, p_key jsonb, p_value jsonb, p_retiring boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF p_retiring AND p_rule.rev IS NULL THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  PERFORM require_version_condition(
    p_op, 'rule', p_key, p_rule.rev, p_rule.last_op_id, p_value, p_rule.rev IS NULL
  );
END;
$$;

CREATE FUNCTION ppt.apply_rule_operation(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  op_key text := p_op->>'op_id';
  payload jsonb := p_op->'payload';
  rule_key text := payload->>'rule_id';
  entity_key jsonb := jsonb_build_object('rule_id', rule_key);
  retiring boolean := p_op->>'type' = 'rule.retire';
  previous rules;
  previous_version rule_versions;
  updated rules;
  updated_version rule_versions;
  previous_value jsonb;
  updated_value jsonb;
  unchanged boolean;
BEGIN
  SELECT * INTO previous FROM rules WHERE class_id = class_key AND rule_id = rule_key;
  SELECT * INTO previous_version FROM rule_versions
  WHERE class_id = class_key AND rule_id = rule_key AND rev = previous.rev;

  previous_value := rule_value(previous, previous_version);
  PERFORM require_rule_target(p_op, previous, entity_key, previous_value, retiring);

  IF retiring THEN
    updated := previous;
    updated.disabled := true;
    updated_version := previous_version;
  ELSE
    updated := ROW(class_key, rule_key, payload->>'kind', (payload->>'event')::rule_event,
      false, NULL, NULL)::rules;
    updated_version := jsonb_populate_record(NULL::rule_versions, payload);
    PERFORM require_rule_save_terms(previous, updated);
  END IF;

  updated.rev := coalesce(previous.rev, 0) + 1;
  updated.last_op_id := op_key;
  updated_version.effective_at := p_time;
  updated_value := rule_value(updated, updated_version);
  unchanged := updated_value IS NOT DISTINCT FROM previous_value;
  IF unchanged THEN
    updated.rev := previous.rev;
  ELSE
    PERFORM store_rule_version(updated, updated_version);
  END IF;

  RETURN (
    operation_result(p_noop => unchanged),
    jsonb_build_array(entity_change(
      'rule', entity_key, coalesce(previous.rev, 0), updated.rev, op_key, previous_value, updated_value
    )),
    '[]'::jsonb
  )::operation_outcome;
END;
$$;
