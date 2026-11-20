CREATE FUNCTION ppt.correction_round_receipt_changes(p_target ppt.operations)
RETURNS TABLE (change jsonb, receipt_order bigint)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT entry.change, entry.receipt_order
  FROM jsonb_array_elements(p_target.receipt->'changes') WITH ORDINALITY AS entry(change, receipt_order)
  WHERE entry.change->>'entity' = 'correction';
$$;

CREATE FUNCTION ppt.undo_correction_round_current(p_row ppt.corrections)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT current_entity_revision(p_row.class_id, p_row.last_op_id, p_row.rev, correction_round_value(p_row))
    || jsonb_build_object('correction_id', p_row.correction_id, 'basis_rev', p_row.basis_rev);
$$;

CREATE FUNCTION ppt.check_undo_correction_round_basis(p_target ppt.operations, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  entry jsonb;
  current_round corrections;
BEGIN
  FOR entry IN SELECT change FROM correction_round_receipt_changes(p_target) ORDER BY receipt_order
  LOOP
    current_round := load_correction_round(p_target.class_id, entry->'key'->>'correction_id');
    IF current_round.basis_rev IS DISTINCT FROM (entry->>'rev')::integer THEN
      PERFORM reject_undo_conflict(p_actor, 'basis_changed', undo_correction_round_current(current_round));
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.check_undo_correction_round(p_target ppt.operations, p_actor jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  original corrections := load_correction_round(p_target.class_id, p_target.payload->>'correction_id');
  blocking_round corrections;
  effect_key text;
BEGIN
  PERFORM require_submission_targets(original.class_id, original.task_id, original.student_id, p_actor);
  PERFORM check_undo_correction_round_basis(p_target, p_actor);

  IF p_target.type IN ('correction.confirm', 'correction.redo', 'correction.cancel') THEN
    blocking_round := open_correction_round(
      original.class_id, original.task_id, original.student_id, p_target.payload->>'next_correction_id'
    );
    IF blocking_round.correction_id IS NOT NULL THEN
      PERFORM reject_undo_conflict(p_actor, 'open_round_exists', undo_correction_round_current(blocking_round));
    END IF;
  END IF;

  effect_key := undo_effect_conflict(original.class_id, original.student_id, p_target.receipt->'result');
  IF effect_key IS NOT NULL THEN
    PERFORM reject_undo_conflict(p_actor, 'effect_already_active',
      undo_correction_round_current(original) || jsonb_build_object('effect_id', effect_key));
  END IF;
END;
$$;

CREATE FUNCTION ppt.restore_correction_round(p_row ppt.corrections, p_change jsonb, p_op_id text)
RETURNS ppt.corrections
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE corrections
  SET status = coalesce(p_change->'prev_value'->>'status', 'cancelled'),
      rev = rev + 1, basis_rev = (p_change->>'prev_basis_rev')::integer, last_op_id = p_op_id
  WHERE class_id = p_row.class_id AND correction_id = p_row.correction_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.undo_correction_round(p_target ppt.operations, p_op_id text, p_time timestamptz)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  entry jsonb;
  previous corrections;
  updated corrections;
  changes jsonb := '[]';
  effect_outcome submission_effect_outcome;
BEGIN
  -- OP-21 的新輪列在第二項，必須先取消才能回復舊輪。
  FOR entry IN SELECT change FROM correction_round_receipt_changes(p_target) ORDER BY receipt_order DESC
  LOOP
    previous := load_correction_round(p_target.class_id, entry->'key'->>'correction_id');
    updated := restore_correction_round(previous, entry, p_op_id);
    changes := changes || jsonb_build_array(correction_round_change(previous, updated, 'status'));
  END LOOP;

  effect_outcome := undo_event_effects(p_target.class_id, updated.student_id, p_target.receipt->'result', p_op_id, p_time);
  IF effect_outcome.account_change IS NOT NULL THEN
    changes := changes || jsonb_build_array(effect_outcome.account_change);
  END IF;
  RETURN (effect_outcome.result, changes, effect_outcome.warnings);
END;
$$;
