import { queryDerivedData } from './derived.js'
import { withClassReadSnapshot } from './snapshot.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassState(pool, config, classId, readTime, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, function readState(client, classSeq) {
    return queryClassState(client, classId, classSeq, readTime)
  })
}

export async function queryClassState(client, classId, classSeq, readTime) {
  const rows = await queryClassVersionRows(client, classId)
  const derived = await queryDerivedData(client, classId, readTime, {})
  return { classSeq, rows, ...derived }
}

export function buildStateResponse(readTime, { classSeq, ...data }) {
  return { server_time: readTime.toISOString(), class_seq: classSeq, ...data }
}
