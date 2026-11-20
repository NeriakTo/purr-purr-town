CREATE TYPE ppt.rule_event AS ENUM (
  'submission.late', 'submission.missing', 'daily_quest.complete',
  'correction.confirmed', 'correction.overdue'
);

CREATE TABLE ppt.rules (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  rule_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('manual', 'event')),
  event ppt.rule_event,
  disabled boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, rule_id),
  CHECK ((kind = 'event') = (event IS NOT NULL))
);

CREATE UNIQUE INDEX rules_one_enabled_event
  ON ppt.rules (class_id, event) WHERE kind = 'event' AND NOT disabled;

CREATE TABLE ppt.rule_versions (
  class_id text NOT NULL,
  rule_id text NOT NULL,
  rev integer NOT NULL CHECK (rev >= 1),
  name text NOT NULL,
  amount numeric NOT NULL,
  icon text,
  category text,
  effective_at timestamptz NOT NULL,
  PRIMARY KEY (class_id, rule_id, rev),
  FOREIGN KEY (class_id, rule_id) REFERENCES ppt.rules (class_id, rule_id)
);

ALTER TABLE ppt.rules ADD FOREIGN KEY (class_id, rule_id, rev)
  REFERENCES ppt.rule_versions (class_id, rule_id, rev) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ppt.prevent_rule_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '規則版本只能新增';
END;
$$;

CREATE TRIGGER rule_versions_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON ppt.rule_versions
FOR EACH STATEMENT EXECUTE FUNCTION ppt.prevent_rule_version_mutation();

ALTER TABLE ppt.transactions
  ADD COLUMN rule_id text,
  ADD COLUMN rule_rev integer,
  ADD CHECK ((rule_id IS NULL) = (rule_rev IS NULL)),
  ADD FOREIGN KEY (class_id, rule_id, rule_rev) REFERENCES ppt.rule_versions (class_id, rule_id, rev);

CREATE TABLE ppt.effects (
  class_id text NOT NULL,
  effect_id text NOT NULL,
  student_id text NOT NULL,
  event ppt.rule_event,
  subject_kind text NOT NULL,
  subject_key text NOT NULL,
  rule_id text,
  rule_rev integer,
  root_transaction_id text,
  status text NOT NULL CHECK (status IN ('active', 'reversed', 'legacy_unresolved', 'dismissed')),
  origin text NOT NULL CHECK (origin IN ('op', 'legacy')),
  lineage_id text NOT NULL,
  suggested_transaction_id text,
  created_op_id text,
  reversed_op_id text,
  PRIMARY KEY (class_id, effect_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id),
  FOREIGN KEY (class_id, rule_id, rule_rev) REFERENCES ppt.rule_versions (class_id, rule_id, rev),
  FOREIGN KEY (class_id, created_op_id) REFERENCES ppt.operations (class_id, op_id),
  FOREIGN KEY (class_id, reversed_op_id) REFERENCES ppt.operations (class_id, op_id),
  CHECK ((rule_id IS NULL) = (rule_rev IS NULL)),
  CHECK (status NOT IN ('active', 'reversed') OR (event IS NOT NULL AND root_transaction_id IS NOT NULL)),
  CHECK (status <> 'legacy_unresolved' OR (event IS NULL AND root_transaction_id IS NULL)),
  CHECK (status IN ('active', 'reversed') OR origin = 'legacy')
);

CREATE UNIQUE INDEX effects_one_active_target
  ON ppt.effects (class_id, student_id, event, subject_kind, subject_key) WHERE status = 'active';

CREATE UNIQUE INDEX effects_one_active_lineage
  ON ppt.effects (class_id, lineage_id) WHERE status = 'active';
