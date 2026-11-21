const transactionProjection = `to_jsonb(tx) - 'class_id'
  || jsonb_build_object('class_seq', op.class_seq)`
const operationProjection = `jsonb_build_object(
  'op_id', op.op_id, 'type', op.type, 'actor_kind', op.actor_kind,
  'class_seq', op.class_seq, 'committed_at', op.committed_at,
  'batch_id', op.batch_id, 'client_time', op.client_time, 'payload', op.payload
)`

const transactionOrder = 'coalesce(op.class_seq, 0), tx.occurred_at, tx.transaction_id COLLATE "C"'

function readLimit(params, pageSize) {
  if (pageSize === undefined) return ''
  return `LIMIT $${params.push(pageSize + 1)}`
}

export async function queryTransactions(client, classId, { sinceSeq, pageSize, key } = {}) {
  const params = [classId]
  let filter = ''
  if (sinceSeq !== undefined) {
    params.push(sinceSeq)
    filter = 'AND op.class_seq > $2'
  } else if (key !== undefined) {
    params.push(...key)
    filter = `AND (${transactionOrder}) < ($2::bigint, $3::timestamptz, $4::text)`
  }
  const limit = readLimit(params, pageSize)
  const { rows } = await client.query(`
    SELECT ${transactionProjection} AS item
    FROM ppt.transactions AS tx
    LEFT JOIN ppt.operations AS op ON op.class_id = tx.class_id AND op.op_id = tx.op_id
    WHERE tx.class_id = $1 ${filter}
    ORDER BY coalesce(op.class_seq, 0) DESC, tx.occurred_at DESC, tx.transaction_id COLLATE "C" DESC
    ${limit}
  `, params)
  return rows.map(row => row.item)
}

export async function queryOperations(client, classId, { sinceSeq, pageSize, key }) {
  const params = [classId]
  let filter = ''
  if (sinceSeq !== undefined) {
    params.push(sinceSeq)
    filter = 'AND op.class_seq > $2'
  } else if (key !== undefined) {
    params.push(key[0])
    filter = 'AND op.class_seq < $2'
  }
  const limit = readLimit(params, pageSize)
  const { rows } = await client.query(`
    SELECT ${operationProjection} AS item
    FROM ppt.operations AS op
    WHERE op.class_id = $1 AND op.status = 'committed' ${filter}
    ORDER BY op.class_seq DESC
    ${limit}
  `, params)
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
