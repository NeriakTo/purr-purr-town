import { operation } from './schoolwork.js'

export function propose({ classId, taskId, studentId }, proposedStatus) {
  return operation(classId, 'submission.propose', {
    task_id: taskId, student_id: studentId, proposed_status: proposedStatus,
  })
}

export function confirm(classId, confirmationId, type = 'confirmation.confirm') {
  return operation(classId, type, { confirmation_id: confirmationId })
}

export async function confirmationsFor(client, classId) {
  const { rows } = await client.query(`
    SELECT * FROM ppt.confirmations WHERE class_id = $1 ORDER BY created_at, confirmation_id
  `, [classId])
  return rows
}

export async function submissionData(client, classId) {
  const { rows: [row] } = await client.query(`
    SELECT
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY task_id, student_id) FROM ppt.submissions s WHERE class_id = $1) AS submissions,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY student_id) FROM ppt.accounts a WHERE class_id = $1) AS accounts,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY transaction_id) FROM ppt.transactions t WHERE class_id = $1) AS transactions,
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY effect_id) FROM ppt.effects e WHERE class_id = $1) AS effects
  `, [classId])
  return row
}
