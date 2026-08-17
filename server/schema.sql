-- Purr Purr Town Database Schema
-- PostgreSQL 16

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  passcode_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  year TEXT,
  name TEXT NOT NULL,
  teacher TEXT,
  alias TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  student_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_ownership (
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, teacher_id)
);

-- 縱深防禦：每個班級只能有一位擁有者。即使應用層邏輯出錯，
-- 也不可能為同一班級新增第二位擁有者（防班級奪取）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_ownership_class ON class_ownership(class_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- 90 天閒置滑動；validateToken 於剩餘 < 30 天時延展（見 auth.js）
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE TABLE IF NOT EXISTS class_snapshots (
  class_id TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_snapshots_updated ON class_snapshots(updated_at);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);
CREATE INDEX IF NOT EXISTS idx_class_ownership_teacher ON class_ownership(teacher_id);
