import { expect } from 'vitest'
import { addClass } from './operations.js'
import { assignTask, balanceOf, saveEventRule } from './submission-flow.js'
import { submissionRow } from './submissions.js'

export const lateEvent = 'submission.late'
export const missingEvent = 'submission.missing'

export async function setupSubmissionUndo(client) {
  const target = await assignTask(client, await addClass(client))
  const lateRule = await saveEventRule(client, target.classId, lateEvent, -10)
  await saveEventRule(client, target.classId, missingEvent, -20)
  return { target, lateRule }
}

export async function expectSubmissionState(client, target, rev, basis, status, balance, expectedEffects = []) {
  expect(await submissionRow(client, target)).toMatchObject({
    rev, basis_rev: basis, status, assignment_active: basis !== 0,
  })
  const { rows } = await client.query(`
    SELECT e.event, ppt.effective_transaction_amount(t)::int AS amount
    FROM ppt.effects AS e
    JOIN ppt.transactions AS t ON t.class_id = e.class_id AND t.transaction_id = e.root_transaction_id
    WHERE e.class_id = $1 AND e.student_id = $2 AND e.subject_kind = 'task' AND e.subject_key = $3
      AND e.status = 'active'
    ORDER BY e.event
  `, [target.classId, target.studentId, target.taskId])
  expect(rows).toEqual(expectedEffects.map(([event, amount]) => ({ event, amount })))
  expect(await balanceOf(client, target)).toBe(balance)
}

export async function effectRow(client, classId, effectId) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.effects WHERE class_id = $1 AND effect_id = $2', [classId, effectId],
  )
  return row
}
