CREATE FUNCTION ppt.undo_effect_additions(p_result jsonb)
RETURNS SETOF jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT effect FROM jsonb_array_elements(p_result->'effects_added') WITH ORDINALITY AS added(effect, position)
  WHERE effect->>'event' <> 'daily_quest.complete'
  ORDER BY position;
$$;

CREATE FUNCTION ppt.undo_effect_restorations(p_result jsonb)
RETURNS SETOF jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT effect FROM jsonb_array_elements(p_result->'effects_reversed') WITH ORDINALITY AS reversed(effect, position)
  WHERE effect->>'event' <> 'daily_quest.complete' AND (effect->>'effective_amount')::numeric <> 0
  ORDER BY position;
$$;

CREATE FUNCTION ppt.undo_effect_conflict(p_class_id text, p_student_id text, p_result jsonb)
RETURNS text
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  WITH to_reverse AS (
    SELECT e.effect_id, e.root_transaction_id
    FROM undo_effect_additions(p_result) AS original
    JOIN effects AS e ON e.class_id = p_class_id AND e.lineage_id = original->>'lineage_id'
    WHERE e.status = 'active'
  )
  SELECT effect_id
  FROM (
    SELECT active.effect_id
    FROM undo_effect_restorations(p_result) AS snapshot
    JOIN effects AS active ON active.class_id = p_class_id AND active.status = 'active'
      AND (active.lineage_id = snapshot->>'lineage_id' OR (
        active.student_id = p_student_id AND active.event = (snapshot->>'event')::rule_event
        AND active.subject_kind = snapshot->>'subject_kind' AND active.subject_key = snapshot->>'subject_key'
      ))
    WHERE NOT EXISTS (SELECT 1 FROM to_reverse WHERE effect_id = active.effect_id)

    UNION ALL

    SELECT planned.effect_id FROM to_reverse AS planned
    WHERE EXISTS (
      SELECT 1 FROM transactions
      WHERE class_id = p_class_id AND kind = 'reversal' AND root_transaction_id = planned.root_transaction_id
    ) OR EXISTS (
      SELECT 1 FROM to_reverse AS other
      WHERE other.root_transaction_id = planned.root_transaction_id AND other.effect_id <> planned.effect_id
    )
  ) AS conflicts
  ORDER BY effect_id COLLATE "C"
  LIMIT 1;
$$;

CREATE FUNCTION ppt.latest_undo_lineage_effect(p_class_id text, p_lineage_id text)
RETURNS ppt.effects
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT e.*
  FROM effects AS e LEFT JOIN operations AS o ON o.class_id = e.class_id AND o.op_id = e.created_op_id
  WHERE e.class_id = p_class_id AND e.lineage_id = p_lineage_id AND e.status IN ('active', 'reversed')
  ORDER BY (e.status = 'active') DESC, o.class_seq DESC NULLS LAST, e.effect_id COLLATE "C"
  LIMIT 1;
$$;

CREATE FUNCTION ppt.reverse_undo_effects(
  p_class_id text, p_result jsonb, p_op_id text, p_time timestamptz
)
RETURNS ppt.submission_effect_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  original jsonb;
  effect effects;
  chain transaction_chain;
  effect_result effect_write;
  amount numeric;
  warnings jsonb := '[]';
  transaction_ids jsonb := '[]';
  reversed jsonb := '[]';
  account_change jsonb;
BEGIN
  FOR original IN SELECT * FROM undo_effect_additions(p_result)
  LOOP
    effect := latest_undo_lineage_effect(p_class_id, original->>'lineage_id');
    amount := (original->>'amount')::numeric;
    IF effect.status IS DISTINCT FROM 'active' THEN
      warnings := warnings || jsonb_build_array(undo_change_warning(
        'already_reversed', original, original->>'root_transaction_id', effect.reversed_op_id, amount, NULL
      ));
      CONTINUE;
    END IF;

    chain := load_transaction_chain(p_class_id, effect.root_transaction_id);
    warnings := warnings || undo_amount_warning(chain, amount, original);
    effect_result := reverse_event_effect(effect, p_op_id, p_time);
    transaction_ids := transaction_ids || jsonb_build_array((effect_result.entry).transaction_id);
    reversed := reversed || jsonb_build_array(effect_result.snapshot);
    account_change := merge_account_change(account_change, (effect_result.entry).account_change);
  END LOOP;
  RETURN (operation_result(transaction_ids, p_effects_reversed => reversed), account_change, warnings)
    ::submission_effect_outcome;
END;
$$;

CREATE FUNCTION ppt.undo_event_effects(
  p_class_id text, p_student_id text, p_result jsonb, p_op_id text, p_time timestamptz
)
RETURNS ppt.submission_effect_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  reversed submission_effect_outcome := reverse_undo_effects(p_class_id, p_result, p_op_id, p_time);
  snapshot jsonb;
  effect_result effect_write;
  transaction_ids jsonb := reversed.result->'transactions';
  added jsonb := '[]';
  account_change jsonb := reversed.account_change;
BEGIN
  FOR snapshot IN SELECT * FROM undo_effect_restorations(p_result)
  LOOP
    effect_result := restore_event_effect(p_class_id, p_student_id, snapshot, p_op_id, p_time);
    transaction_ids := transaction_ids || jsonb_build_array((effect_result.entry).transaction_id);
    added := added || jsonb_build_array(effect_result.snapshot);
    account_change := merge_account_change(account_change, (effect_result.entry).account_change);
  END LOOP;
  RETURN (operation_result(transaction_ids, added, reversed.result->'effects_reversed'),
    account_change, reversed.warnings)::submission_effect_outcome;
END;
$$;
