import { requireTeacher } from '../auth/session.js'
import { readQuery, writeTransaction } from '../db.js'
import { logError, RequestError } from '../errors.js'
import { precheckClassAccess } from './class-access.js'
import { buildOperation, validateSubmitEnvelope } from './envelope.js'

const submitPath = '/api/v2/ops'
const stopCodes = new Set(['CLASS_FORBIDDEN', 'SERVER_BUSY', 'INTERNAL_ERROR'])

function retryReceipt(opId, code) {
  return { op_id: opId ?? null, status: 'retry', code }
}

async function submitOne({ pool, config, hooks }, op, actor, logger) {
  try {
    return await writeTransaction(pool, config, async client => {
      const { rows: [{ receipt }] } = await client.query(
        'SELECT ppt.submit_operation($1::jsonb, $2::jsonb) AS receipt', [op, actor],
      )
      await hooks?.beforeCommit?.(op)
      return receipt
    })
  } catch (error) {
    const failure = error instanceof RequestError ? error : new RequestError('INTERNAL_ERROR')
    logError(logger, submitPath, failure)
    return retryReceipt(typeof op.op_id === 'string' ? op.op_id : null, failure.code)
  }
}

async function processOperations(context, envelope, actor, logger) {
  const receipts = []
  let stopped = false
  for (const op of envelope.ops) {
    const receipt = stopped
      ? retryReceipt(op.op_id, 'NOT_PROCESSED')
      : await submitOne(context, buildOperation(op, envelope), actor, logger)
    receipts.push(receipt)
    stopped ||= receipt.status === 'retry' && stopCodes.has(receipt.code)
  }
  return receipts
}

async function buildSubmitResponse({ pool, clock }, classId, receipts) {
  const { rows: [row] } = await readQuery(pool, 'SELECT class_seq FROM ppt.classes WHERE class_id = $1', [classId])
  return { server_time: clock().toISOString(), class_seq: row ? Number(row.class_seq) : null, receipts }
}

export function registerSubmitRoute(app, context) {
  const { pool, clock } = context
  app.post(submitPath, async request => {
    const actor = await requireTeacher(pool, request.headers.authorization, clock)
    const envelope = request.body
    validateSubmitEnvelope(envelope)
    await precheckClassAccess(pool, envelope.class_id, actor, envelope.ops[0])
    const receipts = await processOperations(context, envelope, actor, app.log)
    return buildSubmitResponse(context, envelope.class_id, receipts)
  })
}
