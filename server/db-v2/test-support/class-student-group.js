import { randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'

export const classInfo = {
  name: '測試班', alias: '測試別名', teacher_name: '測試老師', school_year: '115',
}

export function updateClassInfo(classId, payload = classInfo, version = { rev: 1 }) {
  return operation(classId, 'class.update_info', payload, version)
}

export function setClassStatus(classId, status, version = { rev: 1 }) {
  return operation(classId, 'class.set_status', { status }, version)
}

export function addStudentOperation(classId, fields = {}) {
  return operation(classId, 'student.add', {
    student_id: randomUUID(), seat_number: 2, name: '2號村民', ...fields,
  })
}

export function updateStudentProfile({ classId, studentId }, fields, version = { rev: 1 }) {
  return operation(classId, 'student.update_profile', { student_id: studentId, ...fields }, version)
}

export function setStudentEnrollment({ classId, studentId }, status, version = { rev: 1 }) {
  return operation(classId, 'student.set_enrollment', { student_id: studentId, enrollment_status: status }, version)
}

export function setStudentExemptRules({ classId, studentId }, rules, version = { rev: 1 }) {
  return operation(classId, 'student.set_exempt_rules', { student_id: studentId, rules }, version)
}

export function assignStudentGroups(classId, items) {
  return operation(classId, 'group.assign_students', { items })
}

export function saveGroup(classId, fields = {}, version = { rev: 0 }) {
  return operation(classId, 'group.save', { group_key: '組甲', name: '測試小組', ...fields }, version)
}

export async function classRow(client, classId) {
  const { rows: [row] } = await client.query('SELECT * FROM ppt.classes WHERE class_id = $1', [classId])
  return row
}

export async function studentRow(client, { classId, studentId }) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.students WHERE class_id = $1 AND student_id = $2', [classId, studentId],
  )
  return row
}

export async function groupRow(client, classId, groupKey) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.groups WHERE class_id = $1 AND group_key = $2', [classId, groupKey],
  )
  return row
}
