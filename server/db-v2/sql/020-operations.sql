CREATE TYPE ppt.operation_code AS ENUM (
  'OK', 'OP_CANCELLED', 'BAD_ENVELOPE', 'CLASS_FORBIDDEN', 'INVALID_OP_ID',
  'OP_ID_REUSED', 'UNKNOWN_OP_TYPE', 'FORBIDDEN_ROLE', 'CLASS_ARCHIVED',
  'INVALID_PAYLOAD', 'SCOPE_FORBIDDEN', 'NOT_FOUND', 'ENTITY_INACTIVE', 'INVALID_TRANSITION', 'STALE_STATE',
  'ID_CONFLICT', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'INSUFFICIENT_BALANCE', 'CONFIRMATION_NOT_PENDING',
  'RULE_VERSION_STALE', 'TX_NOT_REVERSIBLE', 'TX_ALREADY_REVERSED'
);

CREATE TABLE ppt.operations (
  op_id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('teacher', 'agent', 'scheduler', 'system')),
  actor_id text NOT NULL,
  type text,
  payload jsonb,
  expect jsonb,
  content_hash bytea,
  status text NOT NULL CHECK (status IN ('committed', 'held', 'rejected', 'cancelled')),
  code ppt.operation_code,
  class_seq bigint CHECK (class_seq > 0),
  recorded_at timestamptz NOT NULL,
  committed_at timestamptz,
  batch_id text,
  client_time text,
  client_seq jsonb,
  receipt jsonb,
  UNIQUE (class_id, op_id),
  UNIQUE (class_id, class_seq),
  CHECK ((status = 'committed') = (class_seq IS NOT NULL)),
  CHECK ((status = 'committed') = (committed_at IS NOT NULL)),
  CHECK (
    (status = 'cancelled' AND type IS NULL AND payload IS NULL AND content_hash IS NULL)
    OR (status <> 'cancelled' AND content_hash IS NOT NULL)
  )
);
