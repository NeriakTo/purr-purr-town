CREATE FUNCTION ppt.class_create_resource_changes(p_class_id text, p_op_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  WITH changes (position, sort_key, value) AS (
    SELECT 1, s.key, entity_change('setting', jsonb_build_object('key', s.key),
      0, s.rev, p_op_id, NULL, jsonb_build_object('value', s.value))
    FROM settings_entries s WHERE s.class_id = p_class_id
    UNION ALL
    SELECT CASE WHEN r.kind = 'event' THEN 2 ELSE 3 END, r.rule_id,
      entity_change('rule', jsonb_build_object('rule_id', r.rule_id), 0, r.rev, p_op_id, NULL, rule_value(r, v))
    FROM rules r JOIN rule_versions v USING (class_id, rule_id, rev) WHERE r.class_id = p_class_id
    UNION ALL
    SELECT 4, j.job_id, entity_change('job', job_key(j.job_id), 0, j.rev, p_op_id, NULL, job_value(j))
    FROM jobs j WHERE j.class_id = p_class_id
    UNION ALL
    SELECT 5, p.product_id, entity_change('product', jsonb_build_object('product_id', p.product_id),
      0, p.rev, p_op_id, NULL, product_value(p))
    FROM products p WHERE p.class_id = p_class_id
    UNION ALL
    SELECT 6, g.group_key, entity_change('group', jsonb_build_object('group_key', g.group_key),
      0, g.rev, p_op_id, NULL, group_value(g))
    FROM groups g WHERE g.class_id = p_class_id
    UNION ALL
    SELECT 7, s.class_id, entity_change('seating', jsonb_build_object('class_id', s.class_id),
      0, s.rev, p_op_id, NULL, seating_value(s))
    FROM seating s WHERE s.class_id = p_class_id
  )
  SELECT coalesce(jsonb_agg(value ORDER BY position, sort_key COLLATE "C"), '[]'::jsonb) FROM changes;
$$;
