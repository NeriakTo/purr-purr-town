import { readQuery } from '../db.js'
import { buildCommentApplication, logCommentOutcome, submitCommentApplication } from './application.js'
import { commentRequestType } from './generation.js'

const job = 'comment_sweep'
const interrupted = { error: '產生中斷，請重按產生' }

async function readGeneratingRequests(pool) {
  const { rows } = await readQuery(pool, `
    SELECT c.class_id, c.student_id, c.semester, latest.request_op_id, latest.committed_at
    FROM ppt.comments c
    JOIN ppt.classes cls ON cls.class_id = c.class_id AND cls.status = 'active'
    JOIN LATERAL (
      SELECT op.op_id AS request_op_id, op.committed_at
      FROM ppt.operations op
      WHERE op.class_id = c.class_id AND op.type = $1 AND op.status = 'committed'
        AND op.payload->>'student_id' = c.student_id AND op.payload->>'semester' = c.semester
      ORDER BY op.class_seq DESC
      LIMIT 1
    ) latest ON true
    WHERE c.generation_status = 'generating'
  `, [commentRequestType])
  return rows
}

async function applicationExists(pool, opId) {
  const { rowCount } = await readQuery(pool, 'SELECT 1 FROM ppt.operations WHERE op_id = $1', [opId])
  return rowCount > 0
}

async function sweepRequest(context, target) {
  const { pool, commentGeneration } = context
  if (commentGeneration?.isGenerating(target)) return

  const operation = buildCommentApplication(target, interrupted)
  if (await applicationExists(pool, operation.op_id)) {
    logCommentOutcome(context, job, target, 'APPLICATION_EXISTS')
    return
  }
  if (commentGeneration?.isGenerating(target)) return

  const receipt = await submitCommentApplication(context, operation)
  logCommentOutcome(context, job, target, receipt.replayed === true ? 'REPLAYED' : receipt.code, receipt.status === 'committed')
}

export async function sweepStuckComments(context) {
  const { pool, config, clock } = context
  const now = clock().getTime()
  const requests = await readGeneratingRequests(pool)
  for (const target of requests) {
    if (now - target.committed_at.getTime() > config.comments.sweepAfterMs) {
      await sweepRequest(context, target)
    }
  }
}
