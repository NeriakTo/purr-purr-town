CREATE FUNCTION ppt.mask_receipt_actor_ids(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN (
      SELECT coalesce(jsonb_object_agg(key, CASE
        WHEN key = 'actor' AND jsonb_typeof(value) = 'object' THEN
          CASE WHEN value ? 'kind' THEN jsonb_build_object('kind', mask_receipt_actor_ids(value->'kind'))
               ELSE '{}'::jsonb END
        ELSE mask_receipt_actor_ids(value)
      END), '{}'::jsonb)
      FROM jsonb_each(p_value)
    )
    WHEN 'array' THEN (
      SELECT coalesce(jsonb_agg(mask_receipt_actor_ids(value) ORDER BY position), '[]'::jsonb)
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS entries(value, position)
    )
    ELSE p_value
  END;
$$;
