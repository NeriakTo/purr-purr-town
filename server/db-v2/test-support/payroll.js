import { randomBytes, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { agentSubmit, authorizeAgent } from './agent.js'
import { classSnapshot } from './checks.js'
import { addClass, submit } from './operations.js'
import { commitOperation, operation } from './schoolwork.js'
import { setSetting } from './settings.js'

export const payrollDay = '2026-12-07'

export function saveJob(classId, fields = {}, version = { rev: 0 }) {
  return operation(classId, 'job.save', {
    job_id: randomUUID(), title: '圖書股長', salary: 10, cycle: 'monthly', ...fields,
  }, version)
}

export function retireJob(classId, jobId, version = { rev: 1 }) {
  return operation(classId, 'job.retire', { job_id: jobId }, version)
}

export function assignJob(classId, jobId, studentIds, version = { rev: 1 }) {
  return operation(classId, 'job.set_assignees', { job_id: jobId, student_ids: studentIds }, version)
}

export function runPayroll(classId, jobIds, fields = { pay_date: payrollDay }) {
  return operation(classId, 'payroll.run', { job_ids: jobIds, ...fields })
}

export function setDuty(classId, date, studentIds, version = { rev: 0 }) {
  return operation(classId, 'duty.set', { date, student_ids: studentIds }, version)
}

export function payDuty(classId, date, fields = {}) {
  return operation(classId, 'duty.pay', { date, ...fields })
}

export function setCutover(client, classId, date) {
  return client.query('UPDATE ppt.classes SET cutover_date = $2 WHERE class_id = $1', [classId, date])
}

export async function addImportedJob(client, classId, {
  jobId = randomBytes(32).toString('hex'), cycle = 'once', origin = 'migration', assigneeIds = [], salary = 10,
} = {}) {
  await client.query(`
    INSERT INTO ppt.jobs (class_id, job_id, title, salary, cycle, origin, assignee_ids)
    VALUES ($1, $2, '匯入職務', $3, $4, $5, $6)
  `, [classId, jobId, salary, cycle, origin, JSON.stringify(assigneeIds)])
  return jobId
}

export async function addPayrollJob(client, classId, studentIds, { retired = false, ...fields } = {}) {
  const op = saveJob(classId, fields)
  const jobId = op.payload.job_id
  await commitOperation(client, op)
  const assigned = await commitOperation(client, assignJob(classId, jobId, studentIds))
  if (retired) await commitOperation(client, retireJob(classId, jobId, { after_op: assigned.op_id }))
  return jobId
}

export async function prepareDuty(client, {
  students = ['enrolled', 'enrolled'], salary = 3, roster = [1, 0], assigned = [], day = payrollDay,
} = {}) {
  const fixture = await addClass(client, { students })
  const { classId, studentIds } = fixture
  const jobId = await addPayrollJob(client, classId, assigned.map((index) => studentIds[index]), {
    title: '值日生', salary, cycle: 'daily',
  })
  await commitOperation(client, setSetting(classId, 'dutyJobId', jobId))
  await commitOperation(client, setDuty(classId, day, roster.map((index) => studentIds[index])))
  return { ...fixture, jobId }
}

export async function payrollRows(client, classId) {
  const { rows } = await client.query(
    "SELECT * FROM ppt.transactions WHERE class_id = $1 AND kind = 'payroll' ORDER BY transaction_id", [classId],
  )
  return rows
}

export async function expectPayrollRejection(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}

export async function expectPayrollRole(client, makeOp) {
  const { classId } = await addClass(client)
  await authorizeAgent(client, classId)
  const { class_id: _classId, ...entry } = makeOp(classId)
  const { receipts: [receipt] } = await agentSubmit(client, classId, [entry])
  expect(receipt.code).toBe('FORBIDDEN_ROLE')
  const { classId: archived } = await addClass(client, { status: 'archived' })
  await expectPayrollRejection(client, makeOp(archived), 'CLASS_ARCHIVED')
}
