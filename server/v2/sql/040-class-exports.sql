CREATE TABLE IF NOT EXISTS ppt_web_state.class_exports (
  class_id text PRIMARY KEY,
  last_export_at timestamptz NOT NULL
);
