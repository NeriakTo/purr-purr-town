import { uuidV5 } from './batch-uuid.js'
import { operation } from './schoolwork.js'

export const commentSemester = '115-1'
export const system = { kind: 'system', id: 'system' }
export const generatedComment = { comment: '產生的評語', motto: '產生的箴言', analysis: '產生的分析', model: '測試模型' }

export function commentApplyId(requestOpId) {
  return uuidV5('7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8', `comment.apply_generated:${requestOpId}`)
}

function commentOperation(target, type, fields, version) {
  const { classId, studentId, semester = commentSemester } = target
  return operation(classId, type, { student_id: studentId, semester, ...fields }, version)
}

export function saveComment(target, fields = { comment: '人工評語' }, version = { rev: 0 }) {
  return commentOperation(target, 'comment.save', fields, version)
}

export function lockComment(target, fields = { comment_locked: true, motto_locked: true }, version = { rev: 0 }) {
  return commentOperation(target, 'comment.set_lock', fields, version)
}

export function requestComment(target, version = { rev: 0 }) {
  return commentOperation(target, 'comment.request_generation', {}, version)
}

export function applyComment(target, requestOpId, fields = generatedComment) {
  const op = commentOperation(target, 'comment.apply_generated', { request_op_id: requestOpId, ...fields })
  return { ...op, op_id: commentApplyId(requestOpId) }
}

export async function commentRow(client, { classId, studentId, semester = commentSemester }) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.comments WHERE class_id = $1 AND student_id = $2 AND semester = $3',
    [classId, studentId, semester],
  )
  return row
}
