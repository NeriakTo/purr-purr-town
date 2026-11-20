CREATE TYPE ppt.effect_write AS (entry ppt.ledger_entry, snapshot jsonb);

CREATE FUNCTION ppt.current_event_rule(p_class_id text, p_event ppt.rule_event)
RETURNS ppt.rule_versions
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT version.*
  FROM rules AS rule JOIN rule_versions AS version USING (class_id, rule_id, rev)
  WHERE rule.class_id = p_class_id AND rule.kind = 'event' AND rule.event = p_event AND NOT rule.disabled;
$$;

CREATE FUNCTION ppt.effect_identity(p_effect ppt.effects)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'effect_id', p_effect.effect_id, 'lineage_id', p_effect.lineage_id, 'event', p_effect.event,
    'subject_kind', p_effect.subject_kind, 'subject_key', p_effect.subject_key,
    'root_transaction_id', p_effect.root_transaction_id
  );
$$;

CREATE FUNCTION ppt.add_event_effect(
  p_class_id text, p_student_id text, p_event ppt.rule_event, p_subject_kind text, p_subject_key text,
  p_op_id text, p_time timestamptz
)
RETURNS ppt.effect_write
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  rule rule_versions := current_event_rule(p_class_id, p_event);
  entry ledger_entry;
  effect_key text := gen_random_uuid()::text;
  effect effects;
BEGIN
  IF rule.rule_id IS NULL OR rule.amount = 0 THEN
    RETURN NULL;
  END IF;

  entry := append_account_transaction(
    p_class_id, p_student_id, p_op_id, 'rule_auto', rule.amount, rule.amount,
    p_time, p_time, rule.name, p_rule_id => rule.rule_id, p_rule_rev => rule.rev
  );
  INSERT INTO effects (
    class_id, effect_id, student_id, event, subject_kind, subject_key, rule_id, rule_rev,
    root_transaction_id, status, origin, lineage_id, created_op_id
  ) VALUES (
    p_class_id, effect_key, p_student_id, p_event, p_subject_kind, p_subject_key,
    rule.rule_id, rule.rev, entry.transaction_id, 'active', 'op', effect_key, p_op_id
  ) RETURNING * INTO effect;
  RETURN (entry, effect_identity(effect) || jsonb_build_object('amount', rule.amount))::effect_write;
END;
$$;

CREATE FUNCTION ppt.reverse_event_effect(p_effect ppt.effects, p_op_id text, p_time timestamptz)
RETURNS ppt.effect_write
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  root transactions;
  effective_amount numeric;
  chain transaction_chain;
  entry ledger_entry;
BEGIN
  chain := load_transaction_chain(p_effect.class_id, p_effect.root_transaction_id);
  root := chain.root;
  IF root.transaction_id IS DISTINCT FROM p_effect.root_transaction_id
      OR root.student_id IS DISTINCT FROM p_effect.student_id OR root.kind = 'legacy_orphan_correction' THEN
    RAISE EXCEPTION '效果的根交易無效';
  END IF;
  effective_amount := chain.effective_amount;

  entry := append_account_transaction(
    root.class_id, root.student_id, p_op_id, 'reversal', -effective_amount, root_earned_delta(root, -effective_amount),
    p_time, root.effective_at, '沖回' || root.reason, root.transaction_id
  );
  UPDATE effects
  SET status = 'reversed', reversed_op_id = p_op_id
  WHERE class_id = p_effect.class_id AND effect_id = p_effect.effect_id;
  RETURN (
    entry,
    effect_identity(p_effect) || jsonb_build_object(
      'rule_id', p_effect.rule_id, 'rule_rev', p_effect.rule_rev,
      'effective_amount', effective_amount, 'effective_at', root.effective_at
    )
  )::effect_write;
END;
$$;
