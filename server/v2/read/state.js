import { withClassReadSnapshot } from './snapshot.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassState(pool, config, classId, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, async function queryClassState(client, classSeq) {
    const rows = await queryClassVersionRows(client, classId)
    return { classSeq, rows }
  })
}

export function buildStateResponse(clock, { classSeq, rows }) {
  return { server_time: clock().toISOString(), class_seq: classSeq, rows }
}
