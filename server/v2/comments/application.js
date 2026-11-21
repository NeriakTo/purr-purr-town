import { commentApplyId } from '../jobs/operation-ids.js'
import { submitAsServer, systemActor } from '../jobs/server-submit.js'
import { taiwanJobTime } from '../jobs/taiwan-time.js'

export function buildCommentApplication(target, fields) {
  const { class_id, request_op_id, student_id, semester } = target
  return {
    op_id: commentApplyId(request_op_id),
    class_id,
    type: 'comment.apply_generated',
    payload: { request_op_id, student_id, semester, ...fields },
  }
}

export function submitCommentApplication({ pool, config, hooks }, operation) {
  return submitAsServer(pool, config, operation, systemActor, hooks)
}

export function logCommentOutcome({ clock, logger }, job, source, code, succeeded = false) {
  const entry = { job, date: taiwanJobTime(clock()).date, code, count: 1 }
  if (succeeded) {
    logger.info(entry)
  } else {
    logger.error({ ...entry, class_id: source.class_id, request_op_id: source.request_op_id })
  }
}

export function commentTargetKey({ class_id, student_id, semester }) {
  return JSON.stringify([class_id, student_id, semester])
}
