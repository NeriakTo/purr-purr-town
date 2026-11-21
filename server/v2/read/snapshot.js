import { readClassSnapshot } from '../db.js'
import { RequestError } from '../errors.js'

async function queryClassSequence(client, classId) {
  const { rows: [row] } = await client.query(`
    SELECT class_seq FROM ppt.classes WHERE class_id = $1
  `, [classId])
  return row?.class_seq
}

export async function withClassReadSnapshot(pool, config, classId, hooks, work) {
  const result = await readClassSnapshot(pool, config, async function readSnapshotData(client) {
    const sequence = await queryClassSequence(client, classId)
    if (sequence === undefined) return null
    await hooks?.duringRead?.()
    return work(client, Number(sequence))
  })
  if (result === null) throw new RequestError('CLASS_FORBIDDEN')
  return result
}
