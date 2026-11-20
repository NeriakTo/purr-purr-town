import { commitOperation, createTask, saveRule } from './schoolwork.js'
import { setStatus } from './submissions.js'

export async function assignTask(client, target, fields = {}) {
  const op = createTask(target.classId, fields)
  await commitOperation(client, op)
  return { ...target, taskId: op.payload.task_id }
}

export async function saveEventRule(client, classId, event, amount) {
  const op = saveRule(classId, { kind: 'event', event, amount })
  await commitOperation(client, op)
  return op.payload
}

export function markSubmission(client, target, status, rev = 1) {
  return commitOperation(client, setStatus(target, status, { rev }))
}

export async function balanceOf(client, { classId, studentId }) {
  const { rows: [row] } = await client.query(
    'SELECT balance::int FROM ppt.accounts WHERE class_id = $1 AND student_id = $2', [classId, studentId],
  )
  return row.balance
}
