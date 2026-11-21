import { requireTeacher } from '../auth/session.js'
import { writeTransaction } from '../db.js'
import { RequestError } from '../errors.js'
import { precheckClassAccess } from './class-access.js'
import { validateClassEnvelope } from './envelope.js'

function readCancelId(opId) {
  return typeof opId === 'string' && !opId.includes('\u0000') ? opId : null
}

async function cancelOne({ pool, config }, classId, opId, actor) {
  return writeTransaction(pool, config, async client => {
    const { rows: [{ receipt }] } = await client.query(
      'SELECT ppt.cancel_operation($1, $2, $3::jsonb) AS receipt', [classId, opId, actor],
    )
    return receipt
  })
}

function buildCancelResponse(clock, receipt) {
  return { server_time: clock().toISOString(), receipt }
}

export function registerCancelRoute(app, context) {
  const { pool, clock } = context
  app.post('/api/v2/ops/cancel', async request => {
    const actor = await requireTeacher(pool, request.headers.authorization, clock)
    const envelope = request.body
    validateClassEnvelope(envelope)
    await precheckClassAccess(pool, envelope.class_id, actor)
    const receipt = await cancelOne(context, envelope.class_id, readCancelId(envelope.op_id), actor)
    if (receipt.status === 'retry' && receipt.code === 'CLASS_FORBIDDEN') throw new RequestError('CLASS_FORBIDDEN')
    return buildCancelResponse(clock, receipt)
  })
}
