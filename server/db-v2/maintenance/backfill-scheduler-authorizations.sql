INSERT INTO ppt.class_authorizations (class_id, actor_kind)
SELECT c.class_id, 'scheduler'
FROM ppt.classes AS c
WHERE NOT EXISTS (
  SELECT 1 FROM ppt.class_authorizations AS a
  WHERE a.class_id = c.class_id AND a.actor_kind = 'scheduler'
)
ORDER BY c.class_id
ON CONFLICT (class_id, actor_kind) DO NOTHING;
