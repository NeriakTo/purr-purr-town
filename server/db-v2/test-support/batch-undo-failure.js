export async function injectBatchUndoFailure(client) {
  await client.query(`
    CREATE FUNCTION ppt.fail_batch_undo_reversal() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, ppt, pg_temp AS $$
    DECLARE
      outer_id text;
    BEGIN
      SELECT batch_id INTO outer_id FROM operations WHERE op_id = NEW.op_id;
      IF outer_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM operations WHERE class_id = NEW.class_id AND batch_id = outer_id
          AND type = 'op.undo' AND status = 'committed'
      ) THEN
        RAISE EXCEPTION '測試注入前第一筆內部撤銷必須已成立';
      END IF;
      RAISE EXCEPTION '測試注入整批撤銷沖回失敗';
    END;
    $$;
    CREATE TRIGGER fail_batch_undo_reversal AFTER INSERT ON ppt.transactions
    FOR EACH ROW WHEN (NEW.kind = 'reversal') EXECUTE FUNCTION ppt.fail_batch_undo_reversal();
  `)
}

export async function removeBatchUndoFailure(client) {
  await client.query(`
    DROP TRIGGER fail_batch_undo_reversal ON ppt.transactions;
    DROP FUNCTION ppt.fail_batch_undo_reversal()
  `)
}
