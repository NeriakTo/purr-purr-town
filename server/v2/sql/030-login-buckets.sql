CREATE TABLE IF NOT EXISTS ppt_web_state.login_buckets (
    bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
    failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
    last_failure_at timestamptz,
    lease_number bigint NOT NULL DEFAULT 0 CHECK (lease_number >= 0),
    lease_expires_at timestamptz,
    next_ticket bigint NOT NULL DEFAULT 0 CHECK (next_ticket >= 0)
);

CREATE TABLE IF NOT EXISTS ppt_web_state.login_queue (
    bucket_key text NOT NULL REFERENCES ppt_web_state.login_buckets (bucket_key) ON DELETE CASCADE,
    ticket bigint NOT NULL CHECK (ticket > 0),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (bucket_key, ticket)
);

CREATE TABLE IF NOT EXISTS ppt_web_state.bucket_busy_counts (
    name text COLLATE "C" PRIMARY KEY,
    count bigint NOT NULL CHECK (count > 0),
    last_at timestamptz NOT NULL
);
