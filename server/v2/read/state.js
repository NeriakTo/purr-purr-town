import { queryDerivedData } from './derived.js'
import { queryStreamPage } from './pagination.js'
import { withClassReadSnapshot } from './snapshot.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassState(pool, config, { classId, cursor }, readTime, hooks) {
  const { pageSize } = config.read
  return withClassReadSnapshot(pool, config, classId, hooks, async function readState(client, classSeq) {
    if (cursor) {
      const page = await queryStreamPage(client, classId, pageSize, cursor)
      return { classSeq, stream: cursor.stream, ...page }
    }
    return queryClassState(client, classId, classSeq, readTime, pageSize)
  })
}

export async function queryClassState(client, classId, classSeq, readTime, pageSize) {
  const rows = await queryClassVersionRows(client, classId)
  const transactions = await queryStreamPage(client, classId, pageSize, { stream: 'transactions' })
  const operations = await queryStreamPage(client, classId, pageSize, { stream: 'operations' })
  const derived = await queryDerivedData(client, classId, readTime, {})
  return { classSeq, rows, transactions, operations, ...derived }
}

export function buildStateResponse(readTime, { classSeq, ...data }) {
  return { server_time: readTime.toISOString(), class_seq: classSeq, ...data }
}
