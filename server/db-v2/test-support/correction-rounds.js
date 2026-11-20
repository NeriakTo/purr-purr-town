import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { agentSubmit, authorizeAgent } from './agent.js'
import { addClass, adjustment, teacher } from './operations.js'
import { commitOperation, operation } from './schoolwork.js'
import { assignTask, balanceOf } from './submission-flow.js'

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

export const confirmedEvent = 'correction.confirmed'
export const overdueEvent = 'correction.overdue'

export async function addOverdueEffect(client, target, rule, amount = rule.amount) {
  const { classId, studentId, correctionId } = target
  const source = await commitOperation(client, adjustment(target, 1))
  const { rows: [{ id }] } = await client.query(`
    SELECT (ppt.append_account_transaction(
      $1, $2, $3, 'rule_auto', $4, $4, $5, $5, '測試逾期扣分', NULL, $6, 1
    )).transaction_id AS id
  `, [classId, studentId, source.op_id, amount, source.committed_at, rule.rule_id])
  const effectId = randomUUID()
  await client.query(`
    INSERT INTO ppt.effects (class_id, student_id, effect_id, lineage_id, event, subject_kind, subject_key,
      rule_id, rule_rev, root_transaction_id, status, origin, created_op_id)
    VALUES ($1, $2, $3, $3, $4, 'correction', $5, $6, 1, $7, 'active', 'op', $8)
  `, [classId, studentId, effectId, overdueEvent, correctionId, rule.rule_id, id, source.op_id])
  return { effectId, rootId: id, effectiveAt: source.committed_at }
}

export async function expectCorrectionState(client, target, rev, basis, status, balance, effects = []) {
  expect(await correctionRow(client, target)).toMatchObject({ rev, basis_rev: basis, status })
  const { rows } = await client.query(`
    SELECT e.event, ppt.effective_transaction_amount(t)::int AS amount
    FROM ppt.effects e
    JOIN ppt.transactions t ON t.class_id = e.class_id AND t.transaction_id = e.root_transaction_id
    WHERE e.class_id = $1 AND e.student_id = $2 AND e.subject_kind = 'correction' AND e.subject_key = $3
      AND e.status = 'active'
    ORDER BY e.event
  `, [target.classId, target.studentId, target.correctionId])
  expect(rows).toEqual(effects.map(([event, amount]) => ({ event, amount })))
  expect(await balanceOf(client, target)).toBe(balance)
}

export async function setupOpenRoundConflict(client) {
  const target = await createRound(client, await setupCorrectionTask(client))
  const original = await commitOperation(client, changeRound(target, 'cancel', { rev: 1 }, { reverse_effects: false }))
  const next = await createRound(client, target, { note: '重算第二題' })
  const { created, correctionId } = next
  return {
    target,
    original,
    current: {
      correction_id: correctionId, rev: 1, basis_rev: 1,
      value: { status: 'required', round: 2, due_on: null, overdue_on: null },
      last_op_id: created.op_id, actor: teacher, committed_at: created.committed_at,
    },
  }
}

export async function setCorrectionDueOperation(client, target) {
  const round = await createRound(client, await assignTask(client, target))
  const dueOn = await taipeiDayOffset(client, -1)
  return changeRound(round, 'set_due', { rev: 1 }, { due_on: dueOn })
}
