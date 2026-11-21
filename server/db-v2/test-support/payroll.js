import { randomBytes, randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'

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
