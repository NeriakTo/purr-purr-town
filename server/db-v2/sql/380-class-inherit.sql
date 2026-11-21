CREATE FUNCTION ppt.lock_class_inherit_source(p_source_id text, p_actor jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  IF NOT can_access_class(p_source_id, p_actor) THEN
    RETURN false;
  END IF;
  PERFORM class_id FROM classes WHERE class_id = p_source_id FOR SHARE;
  RETURN FOUND AND can_access_class(p_source_id, p_actor);
END;
$$;

CREATE FUNCTION ppt.copy_class_jobs(p_class_id text, p_source_id text, p_op_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  job jobs;
  duty_job text := duty_job_id(p_source_id);
BEGIN
  FOR job IN SELECT * FROM jobs WHERE class_id = p_source_id AND NOT disabled LOOP
    job.class_id := p_class_id;
    job.assignee_ids := '[]';
    PERFORM store_job(job, p_op_id);
    IF job.job_id = duty_job THEN
      PERFORM store_setting(p_class_id, 'dutyJobId', to_jsonb(duty_job), p_op_id);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.copy_class_manual_rules(
  p_class_id text, p_source_id text, p_op_id text, p_time timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  rule record;
BEGIN
  FOR rule IN
    SELECT r.rule_id, v.name, v.amount, v.icon, v.category FROM rules r
    JOIN rule_versions v USING (class_id, rule_id, rev)
    WHERE r.class_id = p_source_id AND r.kind = 'manual' AND NOT r.disabled
  LOOP
    PERFORM store_class_create_rule(p_class_id, rule.rule_id, NULL, rule.name, rule.amount,
      rule.icon, rule.category, p_op_id, p_time);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.copy_class_products(p_class_id text, p_source_id text, p_op_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  product products;
BEGIN
  FOR product IN SELECT * FROM products WHERE class_id = p_source_id AND NOT disabled LOOP
    product.class_id := p_class_id;
    product.initial_stock := coalesce(product.initial_stock, product.stock);
    product.stock := product.initial_stock;
    PERFORM store_product(product, p_op_id);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.class_seating_objects_in_bounds(p_objects jsonb, p_rows integer, p_cols integer)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each(p_objects)
  WHERE CASE WHEN key COLLATE "C" ~ '^[0-9]{1,10}_[0-9]{1,10}$' THEN
    split_part(key, '_', 1)::bigint < p_rows AND split_part(key, '_', 2)::bigint < p_cols
    ELSE false END;
$$;

CREATE FUNCTION ppt.class_inherited_seating(p_source_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT coalesce((
    SELECT seating_value(s) || jsonb_build_object('seats', '{}'::jsonb,
      'objects', class_seating_objects_in_bounds(s.objects, s.rows, s.cols))
    FROM seating s WHERE s.class_id = p_source_id
  ), class_default_seating());
$$;

CREATE FUNCTION ppt.store_class_inheritance(
  p_class_id text, p_source_id text, p_op_id text, p_time timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  PERFORM store_class_settings(p_class_id, p_op_id, p_source_id);
  PERFORM store_class_event_rules(p_class_id, p_op_id, p_time, p_source_id);
  PERFORM copy_class_manual_rules(p_class_id, p_source_id, p_op_id, p_time);
  PERFORM copy_class_jobs(p_class_id, p_source_id, p_op_id);
  PERFORM copy_class_products(p_class_id, p_source_id, p_op_id);
  INSERT INTO groups (class_id, group_key, name, last_op_id)
    SELECT p_class_id, group_key, name, p_op_id FROM groups WHERE class_id = p_source_id;
  PERFORM store_seating_save(p_class_id, p_op_id, class_inherited_seating(p_source_id), NULL);
END;
$$;
