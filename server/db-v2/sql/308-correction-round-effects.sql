CREATE FUNCTION ppt.apply_correction_round_confirm(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous corrections := load_correction_round(p_op->>'class_id', p_op->'payload'->>'correction_id');
  op_key text := p_op->>'op_id';
  updated corrections := store_correction_round_status(previous, 'confirmed', op_key);
  changes jsonb := jsonb_build_array(correction_round_change(previous, updated, 'status'));
  reward effect_write;
BEGIN
  reward := add_event_effect(
    updated.class_id, updated.student_id, 'correction.confirmed', 'correction', updated.correction_id, op_key, p_time
  );
  IF reward.snapshot IS NULL THEN
    RETURN (operation_result(), changes, '[]'::jsonb);
  END IF;
  RETURN (
    operation_result(jsonb_build_array((reward.entry).transaction_id), jsonb_build_array(reward.snapshot)),
    changes || jsonb_build_array((reward.entry).account_change), '[]'::jsonb
  );
END;
$$;

CREATE FUNCTION ppt.reverse_correction_round_effects(p_row ppt.corrections, p_op_id text, p_time timestamptz)
RETURNS ppt.submission_effect_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  effect effects;
  reversal effect_write;
  account_change jsonb;
  transactions jsonb := '[]';
  reversed jsonb := '[]';
BEGIN
  FOR effect IN
    SELECT * FROM effects
    WHERE class_id = p_row.class_id AND student_id = p_row.student_id
      AND subject_kind = 'correction' AND subject_key = p_row.correction_id AND status = 'active'
    ORDER BY event::text COLLATE "C"
  LOOP
    reversal := reverse_event_effect(effect, p_op_id, p_time);
    account_change := merge_account_change(account_change, (reversal.entry).account_change);
    transactions := transactions || jsonb_build_array((reversal.entry).transaction_id);
    reversed := reversed || jsonb_build_array(reversal.snapshot);
  END LOOP;
  RETURN (operation_result(transactions, p_effects_reversed => reversed), account_change, '[]'::jsonb);
END;
$$;

CREATE FUNCTION ppt.apply_correction_round_cancel(p_op jsonb, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  previous corrections := load_correction_round(p_op->>'class_id', p_op->'payload'->>'correction_id');
  op_key text := p_op->>'op_id';
  updated corrections := store_correction_round_status(previous, 'cancelled', op_key);
  changes jsonb := jsonb_build_array(correction_round_change(previous, updated, 'status'));
  reversal submission_effect_outcome;
BEGIN
  IF NOT (p_op->'payload'->>'reverse_effects')::boolean THEN
    RETURN (operation_result(), changes, '[]'::jsonb);
  END IF;

  reversal := reverse_correction_round_effects(updated, op_key, p_time);
  IF reversal.account_change IS NOT NULL THEN
    changes := changes || jsonb_build_array(reversal.account_change);
  END IF;
  RETURN (reversal.result, changes, reversal.warnings);
END;
$$;
