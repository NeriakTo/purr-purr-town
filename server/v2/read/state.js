import { withClassReadSnapshot } from './snapshot.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassState(pool, config, classId, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, function readState(client, classSeq) {
    return queryClassState(client, classId, classSeq)
  })
}

export async function queryClassState(client, classId, classSeq) {
  const rows = await queryClassVersionRows(client, classId)
  return { classSeq, rows }
}

export function buildStateResponse(clock, { classSeq, rows }) {
  return { server_time: clock().toISOString(), class_seq: classSeq, rows }
}
