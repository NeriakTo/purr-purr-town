import { requireTeacher } from '../auth/session.js'
import { readSnapshot } from '../db.js'
import { precheckClassAccess } from './class-access.js'
import { validateLookupEnvelope } from './envelope.js'

function readOwnOperations(pool, classId, opIds, actor) {
  // PostgreSQL 的 text 無法保存 NUL，這些編號在回應組裝時會得到 unknown。
  const searchableIds = opIds.filter(opId => !opId.includes('\u0000'))
  return readSnapshot(pool, async client => {
    const { rows } = await client.query(`
      SELECT op_id, type, receipt
      FROM ppt.operations
      WHERE class_id = $1 AND op_id = ANY($2::text[]) AND actor_kind = 'teacher' AND actor_id = $3
    `, [classId, searchableIds, actor.id])
    return rows
  })
}

function buildLookupResponse(clock, opIds, rows) {
  const byId = new Map(rows.map(row => [row.op_id, { ...row.receipt, op_type: row.type }]))
  const results = opIds.map(opId => byId.get(opId) ?? { op_id: opId, status: 'unknown' })
  return { server_time: clock().toISOString(), results }
}

export function registerLookupRoute(app, { pool, clock }) {
  app.post('/api/v2/ops/lookup', async request => {
    const actor = await requireTeacher(pool, request.headers.authorization, clock)
    const envelope = request.body
    validateLookupEnvelope(envelope)
    await precheckClassAccess(pool, envelope.class_id, actor)
    const rows = await readOwnOperations(pool, envelope.class_id, envelope.op_ids, actor)
    return buildLookupResponse(clock, envelope.op_ids, rows)
  })
}
