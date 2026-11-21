CREATE TABLE ppt_web_state.device_markers (
  marker_hash text PRIMARY KEY CHECK (marker_hash ~ '^[0-9a-f]{64}$'),
  teacher_id text NOT NULL CHECK (teacher_id <> ''),
  created_at timestamptz NOT NULL
);
