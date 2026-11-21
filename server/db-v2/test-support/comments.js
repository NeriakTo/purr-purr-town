import { operation } from './schoolwork.js'

export const commentSemester = '115-1'

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

export async function commentRow(client, { classId, studentId, semester = commentSemester }) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.comments WHERE class_id = $1 AND student_id = $2 AND semester = $3',
    [classId, studentId, semester],
  )
  return row
}
