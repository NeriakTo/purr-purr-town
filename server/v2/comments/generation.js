import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'
import { buildCommentApplication, commentTargetKey, logCommentOutcome, submitCommentApplication } from './application.js'
import { generateComment, raceWithAbort } from './walle.js'

export const commentRequestType = 'comment.request_generation'
const job = 'comment_generation'

async function readRequestTarget(pool, { class_id, request_op_id }) {
  const { rows: [target] } = await readQuery(pool, `
    SELECT class_id, op_id AS request_op_id, payload->>'student_id' AS student_id, payload->>'semester' AS semester
    FROM ppt.operations
    WHERE class_id = $1 AND op_id = $2 AND type = $3 AND status = 'committed'
  `, [class_id, request_op_id, commentRequestType])
  return target
}

async function readGenerationRecord(pool, { class_id, student_id, semester }) {
  const { rows: [record] } = await readQuery(pool, `
    SELECT observation, locked_comment, locked_motto,
      (SELECT jsonb_agg(jsonb_build_object('student_id', s.student_id, 'name', s.name, 'seat_number', s.seat_number))
       FROM ppt.students s WHERE s.class_id = c.class_id) AS roster
    FROM ppt.comments c
    WHERE c.class_id = $1 AND c.student_id = $2 AND c.semester = $3
  `, [class_id, student_id, semester])
  return record
}

async function applyWithRetries(context, operation, shutdown) {
  let receipt = await submitCommentApplication(context, operation)
  for (const delay of context.config.comments.retryDelaysMs) {
    if (receipt.status !== 'retry' || shutdown.aborted) break
    await raceWithAbort(function waitBeforeRetry() {
      return context.sleep(delay, shutdown)
    }, shutdown)
    if (shutdown.aborted) break
    receipt = await submitCommentApplication(context, operation)
  }
  return receipt
}

function reportApplication(context, target, result, receipt) {
  const committed = receipt.status === 'committed'
  const code = (committed && result.code) || receipt.code
  logCommentOutcome(context, job, target, code, committed && !result.code)
}

export function createCommentGeneration(context) {
  const activeTargets = new Set()
  const pending = new Map()
  let closed = false

  function isGenerating(target) {
    return activeTargets.has(commentTargetKey(target))
  }

  function reportTriggerFailure(source) {
    logCommentOutcome(context, job, source, 'INTERNAL_ERROR')
  }

  async function runGeneration(source, shutdown) {
    const target = await readRequestTarget(context.pool, source)
    if (shutdown.aborted) return
    if (!target) return logCommentOutcome(context, job, source, 'NOT_FOUND')
    const key = commentTargetKey(target)
    if (activeTargets.has(key)) return
    activeTargets.add(key)
    try {
      const record = await readGenerationRecord(context.pool, target)
      if (shutdown.aborted) return
      const student = record?.roster?.find(row => row.student_id === target.student_id)
      if (!student) return logCommentOutcome(context, job, target, 'NOT_FOUND')

      const result = await generateComment(context, record, student, shutdown)
      if (shutdown.aborted) return
      const operation = buildCommentApplication(target, result.fields)
      const receipt = await applyWithRetries(context, operation, shutdown)
      if (!shutdown.aborted) reportApplication(context, target, result, receipt)
    } finally {
      activeTargets.delete(key)
    }
  }

  function trigger({ class_id, request_op_id }) {
    if (closed) return
    const source = { class_id, request_op_id }
    context.hooks?.onGenerationTrigger?.(source)
    const controller = new AbortController()
    const task = runGeneration(source, controller.signal).catch(function reportFailure(error) {
      if (controller.signal.aborted) return
      const code = error instanceof RequestError && error.code === 'SERVER_BUSY' ? error.code : 'INTERNAL_ERROR'
      logCommentOutcome(context, job, source, code)
    }).finally(function finishTask() {
      pending.delete(task)
    })
    pending.set(task, controller)
    return task
  }

  async function whenIdle() {
    while (pending.size) await Promise.all(pending.keys())
  }

  async function close() {
    closed = true
    for (const controller of pending.values()) controller.abort()
    await whenIdle()
  }

  return { trigger, reportTriggerFailure, isGenerating, whenIdle, close }
}
