CREATE TYPE ppt.operation_outcome AS (result jsonb, changes jsonb, warnings jsonb);

CREATE FUNCTION ppt.retry_receipt(p_op_id text, p_code ppt.operation_code)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object('op_id', p_op_id, 'status', 'retry', 'code', p_code);
$$;

CREATE FUNCTION ppt.operation_result(
  p_transactions jsonb DEFAULT '[]',
  p_effects_added jsonb DEFAULT '[]',
  p_effects_reversed jsonb DEFAULT '[]',
  p_noop boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'noop', p_noop, 'transactions', p_transactions,
    'effects_added', p_effects_added, 'effects_reversed', p_effects_reversed
  );
$$;

CREATE FUNCTION ppt.operation_receipt(
  p_op_id text,
  p_status text,
  p_code ppt.operation_code,
  p_class_seq bigint DEFAULT NULL,
  p_committed_at timestamptz DEFAULT NULL,
  p_result jsonb DEFAULT NULL,
  p_changes jsonb DEFAULT '[]',
  p_warnings jsonb DEFAULT '[]',
  p_current jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
SET timezone = 'UTC'
AS $$
  SELECT jsonb_build_object(
    'op_id', p_op_id, 'status', p_status, 'code', p_code, 'replayed', false,
    'class_seq', p_class_seq, 'committed_at', p_committed_at,
    'result', coalesce(p_result, operation_result()),
    'changes', p_changes, 'warnings', p_warnings
  ) || CASE WHEN p_current IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('current', p_current) END;
$$;

CREATE FUNCTION ppt.reject_operation(p_code ppt.operation_code, p_current jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P604R', MESSAGE = p_code::text,
    DETAIL = coalesce(p_current::text, '');
END;
$$;

CREATE FUNCTION ppt.pending_operation(p_key text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '0A000', MESSAGE = '操作分支尚未實作', DETAIL = p_key;
END;
$$;

CREATE FUNCTION ppt.entity_change(
  p_entity text, p_key jsonb, p_prev_rev integer, p_rev integer, p_op_id text,
  p_prev_value jsonb, p_value jsonb
)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT jsonb_build_object(
    'entity', p_entity, 'key', p_key, 'prev_rev', p_prev_rev, 'rev', p_rev,
    'last_op_id', p_op_id, 'prev_value', p_prev_value, 'value', p_value
  );
$$;

CREATE FUNCTION ppt.merge_account_change(p_first jsonb, p_latest jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE WHEN p_first IS NULL THEN p_latest ELSE
    p_latest || jsonb_build_object('prev_rev', p_first->'prev_rev', 'prev_value', p_first->'prev_value')
  END;
$$;
