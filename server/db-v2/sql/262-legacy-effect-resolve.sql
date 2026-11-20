CREATE FUNCTION ppt.validate_legacy_effect_resolution(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  resolution text := p_payload->>'resolution';
BEGIN
  IF NOT has_only_keys(p_payload, ARRAY['effect_id', 'resolution', 'transaction_id', 'event'])
    OR NOT has_nonempty_string(p_payload, 'effect_id')
    OR resolution IS NULL OR resolution NOT IN ('link', 'none')
    OR (resolution = 'link' AND NOT has_nonempty_string(p_payload, 'transaction_id'))
    OR (resolution = 'none' AND (p_payload ? 'transaction_id' OR p_payload ? 'event'))
    OR (p_payload ? 'event' AND NOT coalesce(
      p_payload->>'event' IN ('submission.late', 'submission.missing'), false
    )) THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
END;
$$;

CREATE FUNCTION ppt.load_legacy_effect(p_class_id text, p_effect_id text)
RETURNS ppt.effects
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT * FROM effects WHERE class_id = p_class_id AND effect_id = p_effect_id;
$$;

CREATE FUNCTION ppt.legacy_effect_submission_key(p_effect ppt.effects)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('task_id', p_effect.subject_key, 'student_id', p_effect.student_id);
$$;

CREATE FUNCTION ppt.legacy_effect_link_event(p_status ppt.submission_status, p_payload jsonb)
RETURNS ppt.rule_event
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE p_status
    WHEN 'late' THEN 'submission.late'
    WHEN 'missing' THEN 'submission.missing'
    WHEN 'makeup' THEN p_payload->>'event'
  END::rule_event;
$$;

CREATE FUNCTION ppt.require_legacy_effect_transaction(
  p_effect ppt.effects, p_transaction_id text, p_published_on date
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  chain transaction_chain := load_transaction_chain(p_effect.class_id, p_transaction_id);
  root transactions := chain.root;
BEGIN
  IF root.transaction_id IS DISTINCT FROM p_transaction_id
    OR root.root_transaction_id IS NOT NULL
    OR root.kind <> 'legacy_general' OR root.origin <> 'migration'
    OR root.student_id <> p_effect.student_id
    OR chain.effective_amount >= 0
    OR root.effective_at IS NULL OR (root.effective_at AT TIME ZONE 'Asia/Taipei')::date < p_published_on
    OR EXISTS (
      SELECT 1 FROM effects
      WHERE class_id = p_effect.class_id AND root_transaction_id = p_transaction_id
    ) THEN
    PERFORM reject_operation('TX_NOT_REVERSIBLE');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_legacy_effect_link(
  p_effect ppt.effects, p_status ppt.submission_status, p_payload jsonb, p_published_on date
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  target_event rule_event;
BEGIN
  IF (p_status = 'makeup') <> (p_payload ? 'event') THEN
    PERFORM reject_operation('INVALID_PAYLOAD');
  END IF;
  target_event := legacy_effect_link_event(p_status, p_payload);
  PERFORM require_legacy_effect_transaction(p_effect, p_payload->>'transaction_id', p_published_on);

  IF EXISTS (
    SELECT 1 FROM effects
    WHERE class_id = p_effect.class_id AND student_id = p_effect.student_id
      AND event = target_event AND subject_kind = 'task' AND subject_key = p_effect.subject_key
      AND status = 'active'
  ) THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;
END;
$$;

CREATE FUNCTION ppt.check_legacy_effect_resolution(p_op jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  class_key text := p_op->>'class_id';
  payload jsonb := p_op->'payload';
  target effects := load_legacy_effect(class_key, payload->>'effect_id');
  linking boolean := payload->>'resolution' = 'link';
  submission submissions;
  task tasks;
BEGIN
  IF target.effect_id IS NULL OR (linking AND NOT EXISTS (
    SELECT 1 FROM transactions WHERE class_id = class_key AND transaction_id = payload->>'transaction_id'
  )) THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF target.status <> 'legacy_unresolved' THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;

  IF target.subject_kind <> 'task' THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  task := require_task(class_key, target.subject_key);
  submission := load_submission(class_key, target.subject_key, target.student_id);
  IF submission.rev IS NULL THEN
    PERFORM reject_operation('NOT_FOUND');
  END IF;
  IF linking AND submission.status NOT IN ('late', 'missing', 'makeup') THEN
    PERFORM reject_operation('INVALID_TRANSITION');
  END IF;

  PERFORM require_version_condition(
    p_op, 'submission', legacy_effect_submission_key(target), submission.rev, submission.last_op_id,
    submission_value(submission)
  );
  IF linking THEN
    PERFORM check_legacy_effect_link(target, submission.status, payload, task.published_on);
  END IF;
END;
$$;

CREATE FUNCTION ppt.store_legacy_effect_resolution(p_effect ppt.effects, p_event ppt.rule_event, p_root_id text)
RETURNS ppt.effects
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE effects
  SET status = CASE WHEN p_root_id IS NOT NULL THEN 'active' ELSE 'dismissed' END,
      event = p_event, root_transaction_id = p_root_id
  WHERE class_id = p_effect.class_id AND effect_id = p_effect.effect_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.advance_legacy_effect_submission(p_row ppt.submissions, p_op_id text)
RETURNS ppt.submissions
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  UPDATE submissions SET rev = rev + 1, basis_rev = rev + 1, last_op_id = p_op_id
  WHERE class_id = p_row.class_id AND task_id = p_row.task_id AND student_id = p_row.student_id
  RETURNING *;
$$;

CREATE FUNCTION ppt.apply_legacy_effect_resolution(p_op jsonb)
RETURNS ppt.operation_outcome
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  payload jsonb := p_op->'payload';
  op_key text := p_op->>'op_id';
  target effects := load_legacy_effect(p_op->>'class_id', payload->>'effect_id');
  previous submissions := load_submission(target.class_id, target.subject_key, target.student_id);
  updated submissions;
  resolved effects;
  target_event rule_event;
BEGIN
  IF payload->>'resolution' = 'link' THEN
    target_event := legacy_effect_link_event(previous.status, payload);
  END IF;
  resolved := store_legacy_effect_resolution(target, target_event, payload->>'transaction_id');
  updated := advance_legacy_effect_submission(previous, op_key);
  RETURN (
    operation_result() || jsonb_build_object('legacy_effect', jsonb_build_object(
      'effect_id', resolved.effect_id, 'resolution', payload->>'resolution', 'status', resolved.status,
      'event', resolved.event, 'root_transaction_id', resolved.root_transaction_id
    )),
    jsonb_build_array(submission_change(previous, updated, legacy_effect_submission_key(target), op_key)),
    '[]'::jsonb
  )::operation_outcome;
END;
$$;
