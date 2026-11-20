import { randomUUID } from 'node:crypto'
import { agentSubmit, authorizeAgent } from './agent.js'
import { addClass } from './operations.js'
import { commitOperation, operation } from './schoolwork.js'
import { assignTask } from './submission-flow.js'

export async function setupCorrectionTask(client, options, fields) {
  return assignTask(client, await addClass(client, options), fields)
}

export function requireRound(target, fields = {}) {
  return operation(target.classId, 'correction.require', {
    correction_id: randomUUID(), task_id: target.taskId, student_id: target.studentId, ...fields,
  })
}

export function changeRound(target, action, version, fields = {}) {
  return operation(target.classId, 'correction.' + action, { correction_id: target.correctionId, ...fields }, version)
}

export async function createRound(client, target, fields) {
  const op = requireRound(target, fields)
  const created = await commitOperation(client, op)
  return { ...target, correctionId: op.payload.correction_id, created }
}

export async function returnRound(client, target) {
  return commitOperation(client, changeRound(target, 'mark_returned', { rev: 1 }))
}

export async function correctionRow(client, { classId, correctionId }) {
  const { rows: [row] } = await client.query(
    'SELECT to_jsonb(c) AS value FROM ppt.corrections c WHERE class_id = $1 AND correction_id = $2',
    [classId, correctionId],
  )
  return row?.value
}

export async function taipeiDayOffset(client, days) {
  const { rows: [{ day }] } = await client.query(
    "SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date + $1::int)::text AS day", [days],
  )
  return day
}

export async function setEnrollment(client, { classId, studentId }, enrollment) {
  await client.query(
    'UPDATE ppt.students SET enrollment_status = $3 WHERE class_id = $1 AND student_id = $2',
    [classId, studentId, enrollment],
  )
}

export async function submitAgentCorrection(client, op) {
  const { class_id: classId, ...entry } = op
  const { receipts: [receipt] } = await agentSubmit(client, classId, [entry])
  return receipt
}

export async function authorizeCorrectionAgent(client, { classId }) {
  await authorizeAgent(client, classId)
}
