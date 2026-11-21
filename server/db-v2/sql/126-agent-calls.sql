CREATE TABLE ppt.agent_calls (
  call_id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  note text,
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  created_at timestamptz NOT NULL
);
