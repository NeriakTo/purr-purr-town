CREATE TABLE ppt.accounts (
  class_id text NOT NULL,
  student_id text NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, student_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id)
);

CREATE TABLE ppt.transactions (
  class_id text NOT NULL,
  transaction_id text NOT NULL,
  student_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'adjust', 'rule_auto', 'payroll', 'shop_purchase', 'item_use', 'correction',
    'reversal', 'legacy_general', 'legacy_orphan_correction', 'migration_opening_adjustment'
  )),
  amount numeric NOT NULL,
  earned_delta numeric NOT NULL,
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz,
  reason text NOT NULL,
  root_transaction_id text,
  corrected_transaction_id text,
  restored_from_transaction_id text,
  origin text NOT NULL,
  op_id text,
  batch_id text,
  source_path text,
  legacy_id jsonb,
  transaction_type text,
  legacy_semantics boolean,
  voided boolean NOT NULL DEFAULT false,
  chain_broken boolean NOT NULL DEFAULT false,
  semester text,
  PRIMARY KEY (class_id, transaction_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.accounts (class_id, student_id),
  FOREIGN KEY (class_id, op_id) REFERENCES ppt.operations (class_id, op_id),
  FOREIGN KEY (class_id, root_transaction_id)
    REFERENCES ppt.transactions (class_id, transaction_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (class_id, corrected_transaction_id)
    REFERENCES ppt.transactions (class_id, transaction_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (class_id, restored_from_transaction_id)
    REFERENCES ppt.transactions (class_id, transaction_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (kind <> 'reversal' OR root_transaction_id IS NOT NULL),
  CHECK (
    (origin = 'op' AND op_id IS NOT NULL AND batch_id IS NULL)
    OR (origin = 'migration' AND batch_id IS NOT NULL AND op_id IS NULL)
  )
);

CREATE UNIQUE INDEX transactions_one_reversal_per_root
  ON ppt.transactions (class_id, root_transaction_id)
  WHERE kind = 'reversal';

CREATE FUNCTION ppt.prevent_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, ppt, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '點數交易只能新增';
END;
$$;

CREATE TRIGGER transactions_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON ppt.transactions
FOR EACH STATEMENT EXECUTE FUNCTION ppt.prevent_transaction_mutation();
