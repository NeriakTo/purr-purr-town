const transactionProjection = `to_jsonb(tx) - 'class_id'
  || jsonb_build_object('class_seq', op.class_seq)`
const operationProjection = `jsonb_build_object(
  'op_id', op.op_id, 'type', op.type, 'actor_kind', op.actor_kind,
  'class_seq', op.class_seq, 'committed_at', op.committed_at,
  'batch_id', op.batch_id, 'client_time', op.client_time, 'payload', op.payload
)`

export async function queryChangedTransactions(client, classId, sinceSeq) {
  const { rows } = await client.query(`
    SELECT ${transactionProjection} AS item
    FROM ppt.transactions AS tx
    JOIN ppt.operations AS op ON op.class_id = tx.class_id AND op.op_id = tx.op_id
    WHERE tx.class_id = $1 AND op.class_seq > $2
    ORDER BY op.class_seq DESC, tx.occurred_at DESC, tx.transaction_id DESC
  `, [classId, sinceSeq])
  return rows.map(row => row.item)
}

export async function queryChangedOperations(client, classId, sinceSeq) {
  const { rows } = await client.query(`
    SELECT ${operationProjection} AS item
    FROM ppt.operations AS op
    WHERE op.class_id = $1 AND op.status = 'committed' AND op.class_seq > $2
    ORDER BY op.class_seq DESC
  `, [classId, sinceSeq])
  return rows.map(row => row.item)
}

export async function exceedsChangesThreshold(client, classId, sinceSeq, threshold) {
  const { rowCount } = await client.query(`
    SELECT 1 FROM ppt.operations
    WHERE class_id = $1 AND status = 'committed' AND class_seq > $2
    ORDER BY class_seq
    LIMIT 1 OFFSET $3
  `, [classId, sinceSeq, threshold])
  return rowCount !== 0
}
