-- T-599／1A 草稿：只供審閱，未連線、未執行。
-- migration_v2 是隔離的遷移資料模型；未知值可暫存但禁止未裁決匯入。
-- raw 一律寫 JSON 值（包含 JSON null），不能用 SQL NULL 代替。
-- 每個來源設定鍵／實體各自一列；raw 欄位定義見 README 完整清冊。
-- 權限、操作紀錄、規則觸發、線上寫入程序留給 1B。
CREATE SCHEMA migration_v2;

CREATE TABLE migration_v2.migration_batches (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  source_hash text NOT NULL,
  converter_version text NOT NULL,
  import_rules_enabled boolean NOT NULL CHECK (import_rules_enabled = false),
  validation_errors jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.migration_sources (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.legacy_ids (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  table_name text NOT NULL,
  target_id text NOT NULL,
  UNIQUE (batch_id, table_name, source_path)
);

CREATE TABLE migration_v2.classes (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  name text,
  teacher text,
  current_semester text,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.students (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  name text,
  seat_number jsonb,
  group_key text,
  avatar jsonb,
  enrollment_status text NOT NULL CHECK (enrollment_status IN ('enrolled', 'home_study', 'transferred', 'archived', 'unknown')),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.accounts (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  balance numeric,
  total_earned numeric,
  total_earned_source text NOT NULL,
  ledger_sum numeric,
  earned_recomputed numeric,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.transactions (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  amount numeric,
  reason text,
  occurred_at text,
  balance_after jsonb,
  voided boolean NOT NULL,
  transaction_type text,
  corrected_transaction_id text REFERENCES migration_v2.transactions(id) DEFERRABLE INITIALLY DEFERRED,
  semester text,
  legacy_semantics boolean NOT NULL CHECK (legacy_semantics = true),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.products (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.inventory_items (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  product_id text REFERENCES migration_v2.products(id),
  legacy_index integer NOT NULL,
  purchase_transaction_id text REFERENCES migration_v2.transactions(id),
  consumed boolean NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.comments (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  semester text NOT NULL,
  locked_comment jsonb NOT NULL,
  locked_motto jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.exempt_rules (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.logs (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.tasks (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  log_id text REFERENCES migration_v2.logs(id),
  title text,
  task_type text,
  published_on text,
  due_on text,
  semester text,
  correction_state text,
  original_task_id text REFERENCES migration_v2.tasks(id) DEFERRABLE INITIALLY DEFERRED,
  teacher_confirmed boolean,
  assignees_known boolean NOT NULL CHECK (assignees_known = false),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.submissions (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  legacy_student_id text,
  task_id text REFERENCES migration_v2.tasks(id),
  status text NOT NULL CHECK (status IN ('pending','on_time','late','missing','leave','exempt','makeup','unknown')),
  present boolean NOT NULL,
  assignment_evidence text NOT NULL,
  teacher_confirmed boolean,
  submitted_at text,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.settings_entries (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  key text NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.jobs (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.job_assignments (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  job_id text REFERENCES migration_v2.jobs(id),
  student_id text REFERENCES migration_v2.students(id),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.daily_duties (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.seats (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  coordinate text NOT NULL,
  student_id text REFERENCES migration_v2.students(id),
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.announcements (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.rules (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.groups (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  group_key text NOT NULL,
  UNIQUE (batch_id, source_path)
);

CREATE TABLE migration_v2.semesters (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  class_id text NOT NULL,
  legacy_id jsonb,
  source_path text NOT NULL,
  raw jsonb NOT NULL,
  period_key text NOT NULL,
  UNIQUE (batch_id, source_path)
);

ALTER TABLE migration_v2.migration_sources ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.legacy_ids ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.classes ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.students ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.accounts ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.transactions ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.products ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.inventory_items ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.comments ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.exempt_rules ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.logs ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.tasks ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.submissions ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.settings_entries ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.jobs ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.job_assignments ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.daily_duties ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.seats ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.announcements ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.rules ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.groups ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);
ALTER TABLE migration_v2.semesters ADD FOREIGN KEY (batch_id) REFERENCES migration_v2.migration_batches(id);

-- 舊編號可能重複或缺漏，不能對 legacy_id 本身設 UNIQUE。
CREATE UNIQUE INDEX legacy_target ON migration_v2.legacy_ids (batch_id, table_name, target_id);
-- 穩定 ID 的衝突只允許同來源同內容；異內容衝突由 1B 拒絕，不能盲目覆寫。
-- 孤立關聯的 typed FK 為 NULL，舊 key 與錯誤仍保留，不建虛構學生。
