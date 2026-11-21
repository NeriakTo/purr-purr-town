import { encodeCursor } from './cursor.js'
import { queryOperations, queryTransactions } from './streams.js'

export async function queryStreamPage(client, classId, pageSize, { stream, key }) {
  const query = stream === 'transactions' ? queryTransactions : queryOperations
  const rows = await query(client, classId, { pageSize, key })
  const items = rows.slice(0, pageSize)
  const next = rows.length > pageSize ? encodeCursor(stream, items.at(-1)) : null
  return { items, next }
}
