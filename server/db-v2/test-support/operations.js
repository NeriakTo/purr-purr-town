import { randomUUID } from 'node:crypto'

export const teacher = { kind: 'teacher', id: 'teacher-fixture' }

export async function addClass(client, { owner = teacher, status = 'active', students = ['enrolled'] } = {}) {
  const classId = randomUUID()
  await client.query('INSERT INTO ppt.classes (class_id, status) VALUES ($1, $2)', [classId, status])
  await client.query('INSERT INTO ppt.class_ownership (class_id, teacher_id) VALUES ($1, $2)', [classId, owner.id])
  const studentIds = []
  for (const [index, enrollment] of students.entries()) {
    const studentId = randomUUID()
    const seat = index + 1
    await client.query(`
      INSERT INTO ppt.students (class_id, student_id, seat_number, name, enrollment_status)
      VALUES ($1, $2, $3, $4, $5)
    `, [classId, studentId, seat, seat + '號村民', enrollment])
    await client.query('INSERT INTO ppt.accounts (class_id, student_id) VALUES ($1, $2)', [classId, studentId])
    studentIds.push(studentId)
  }
  return { classId, studentId: studentIds[0], studentIds }
}

export function adjustment({ classId, studentId }, amount = -5) {
  return {
    op_id: randomUUID(),
    class_id: classId,
    type: 'points.adjust',
    payload: { student_id: studentId, amount },
  }
}

export async function submit(client, op, actor = teacher) {
  const { rows: [{ receipt }] } = await client.query(
    'SELECT ppt.submit_operation($1::jsonb, $2::jsonb) AS receipt',
    [typeof op === 'string' ? op : JSON.stringify(op), actor],
  )
  return receipt
}

export async function classSequence(client, classId) {
  const { rows: [{ class_seq: seq }] } = await client.query(
    'SELECT class_seq FROM ppt.classes WHERE class_id = $1', [classId],
  )
  return Number(seq)
}

export async function operationCount(client) {
  const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM ppt.operations')
  return count
}
