CREATE FUNCTION ppt.undo_change_warning(
  p_case text, p_original_effect jsonb, p_transaction_id text, p_changed_by text,
  p_original_amount numeric, p_amount numeric
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'code', 'UNDO_EFFECT_MANUALLY_CHANGED', 'case', p_case,
    'effect_id', p_original_effect->'effect_id', 'lineage_id', p_original_effect->'lineage_id',
    'transaction_id', p_transaction_id, 'changed_by_op_id', p_changed_by,
    'original_amount', p_original_amount, 'amount', p_amount
  );
$$;

CREATE FUNCTION ppt.undo_warning_details(p_warnings jsonb, p_case text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(warning - ARRAY['code', 'case'] ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(p_warnings) WITH ORDINALITY AS entry(warning, position)
  WHERE warning->>'code' = 'UNDO_EFFECT_MANUALLY_CHANGED' AND warning->>'case' = p_case;
$$;

CREATE FUNCTION ppt.undo_outcome(p_target_id text, p_outcome ppt.operation_outcome)
RETURNS ppt.operation_outcome
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT (
    p_outcome.result || jsonb_build_object('undo', jsonb_build_object(
      'target_op_id', p_target_id,
      'skipped', undo_warning_details(p_outcome.warnings, 'already_reversed'),
      'amount_changed', undo_warning_details(p_outcome.warnings, 'amount_changed')
    )), p_outcome.changes, p_outcome.warnings
  )::operation_outcome;
$$;
