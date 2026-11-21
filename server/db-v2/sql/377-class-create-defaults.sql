CREATE FUNCTION ppt.class_default_id(p_class_id text, p_category text, p_code text)
RETURNS text
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT uuid_v5(operation_uuid_namespace(), 'class.create:' || p_class_id || ':' || p_category || ':' || p_code);
$$;

-- Defaults come from src/utils/constants.js.
CREATE FUNCTION ppt.class_default_settings()
RETURNS TABLE (key text, value jsonb)
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  VALUES
    ('currency', '{"base":{"name":"積分","icon":"💎"},"tier1":{"name":"小魚乾","rate":100,"icon":"🐟"},
      "tier2":{"name":"貓餅乾","rate":1000,"icon":"🍪"}}'::jsonb),
    ('ruleCategories', '[{"id":"cat_homework","name":"作業","icon":"📚"},
      {"id":"cat_discipline","name":"秩序","icon":"📏"},{"id":"cat_class","name":"課堂表現","icon":"🎯"},
      {"id":"cat_hygiene","name":"整潔","icon":"🧹"}]'::jsonb),
    ('shopMeta', '{"name":"橘喵商店","icon":"🐱"}'::jsonb),
    ('taskTypes', '["作業","訂正","攜帶物品","考試","通知單","回條"]'::jsonb);
$$;

CREATE FUNCTION ppt.class_default_seating()
RETURNS jsonb
LANGUAGE sql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT '{"rows":6,"cols":8,"view":"teacher","seats":{},"objects":{},"custom_objects":[]}'::jsonb;
$$;

CREATE FUNCTION ppt.store_class_create_rule(
  p_class_id text, p_rule_id text, p_event ppt.rule_event,
  p_name text, p_amount numeric, p_icon text, p_category text, p_op_id text, p_time timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  new_rule rules;
  version rule_versions;
BEGIN
  new_rule.class_id := p_class_id;
  new_rule.rule_id := p_rule_id;
  new_rule.kind := CASE WHEN p_event IS NULL THEN 'manual' ELSE 'event' END;
  new_rule.event := p_event;
  new_rule.disabled := false;
  new_rule.rev := 1;
  new_rule.last_op_id := p_op_id;
  version.name := p_name;
  version.amount := p_amount;
  version.icon := p_icon;
  version.category := p_category;
  version.effective_at := p_time;
  PERFORM store_rule_version(new_rule, version);
END;
$$;

CREATE FUNCTION ppt.store_class_event_rules(
  p_class_id text, p_op_id text, p_time timestamptz, p_source_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT defaults.event, defaults.name, coalesce(source.amount, defaults.amount) AS amount
    FROM (VALUES
      ('submission.late'::rule_event, '作業遲交', -10),
      ('submission.missing'::rule_event, '作業缺交', -20),
      ('daily_quest.complete'::rule_event, '每日任務獎勵', 50)
    ) AS defaults(event, name, amount)
    LEFT JOIN (
      SELECT r.event, v.amount FROM rules r JOIN rule_versions v USING (class_id, rule_id, rev)
      WHERE r.class_id = p_source_id AND r.kind = 'event' AND NOT r.disabled
    ) AS source USING (event)
  LOOP
    PERFORM store_class_create_rule(p_class_id, class_default_id(p_class_id, 'rule', item.event::text),
      item.event, item.name, item.amount, NULL, NULL, p_op_id, p_time);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.store_class_default_manual_rules(p_class_id text, p_op_id text, p_time timestamptz)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('rule_missing_hw', '作業缺交', -200, '📕', '作業'),
    ('rule_good_speak', '發表優良', 100, '🌟', '課堂表現'),
    ('rule_attendance', '全勤獎勵', 500, '🗓️', '秩序')
  ) AS defaults(code, name, amount, icon, category)
  LOOP
    PERFORM store_class_create_rule(p_class_id, class_default_id(p_class_id, 'rule', item.code), NULL,
      item.name, item.amount, item.icon, item.category, p_op_id, p_time);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.store_class_default_jobs(p_class_id text, p_op_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
  job jobs;
BEGIN
  job.class_id := p_class_id;
  job.disabled := false;
  job.assignee_ids := '[]';
  FOR item IN SELECT * FROM (VALUES
    ('job_class_leader', '班長', 300, '👑', 'weekly', 'cadre'),
    ('job_health_leader', '衛生長', 200, '🧹', 'weekly', 'cleaning'),
    ('job_line_leader', '路隊長', 100, '🚶', 'weekly', 'cadre')
  ) AS defaults(code, title, salary, icon, cycle, category)
  LOOP
    job.job_id := class_default_id(p_class_id, 'job', item.code);
    job.title := item.title;
    job.salary := item.salary;
    job.icon := item.icon;
    job.cycle := item.cycle;
    job.category := item.category;
    PERFORM store_job(job, p_op_id);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.store_class_default_products(p_class_id text, p_op_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
  product products;
BEGIN
  product.class_id := p_class_id;
  product.price_unit := 'cookie';
  product.disabled := false;
  FOR item IN SELECT * FROM (VALUES
    ('prod_homework_off', '減功課卡', '📝', 1, 10),
    ('prod_nap_free', '午休免睡卡', '😴', 2, 5),
    ('prod_nap_read', '午休閱讀卡', '📖', 3, 5),
    ('prod_nap_game', '午休桌遊卡', '🎲', 4, 3),
    ('prod_nap_camp', '午休露營卡', '⛺', 5, 1),
    ('prod_nap_tablet', '午休平板卡', '📱', 6, 1)
  ) AS defaults(code, name, icon, price, initial_stock)
  LOOP
    product.product_id := class_default_id(p_class_id, 'product', item.code);
    product.name := item.name;
    product.icon := item.icon;
    product.price := item.price;
    product.stock := item.initial_stock;
    product.initial_stock := item.initial_stock;
    PERFORM store_product(product, p_op_id);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.store_class_settings(p_class_id text, p_op_id text, p_source_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT d.key, d.value, source.value AS source_value
    FROM class_default_settings() d
    LEFT JOIN settings_entries source ON source.class_id = p_source_id AND source.key = d.key
  LOOP
    IF valid_setting_value(item.key, item.value) IS DISTINCT FROM true THEN
      RAISE EXCEPTION '建班預設設定不合格式：%', item.key;
    END IF;
    PERFORM store_setting(p_class_id, item.key, coalesce(item.source_value, item.value), p_op_id);
  END LOOP;
END;
$$;

CREATE FUNCTION ppt.store_class_defaults(p_class_id text, p_op_id text, p_time timestamptz)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  PERFORM store_class_settings(p_class_id, p_op_id);
  PERFORM store_class_event_rules(p_class_id, p_op_id, p_time);
  PERFORM store_class_default_manual_rules(p_class_id, p_op_id, p_time);
  PERFORM store_class_default_jobs(p_class_id, p_op_id);
  PERFORM store_class_default_products(p_class_id, p_op_id);
  PERFORM store_seating_save(p_class_id, p_op_id, class_default_seating(), NULL);
END;
$$;
