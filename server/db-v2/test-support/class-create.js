import { randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'
import { submit } from './operations.js'
import { expect } from 'vitest'

export function createClass(count = 1, classId = randomUUID(), fields = {}) {
  return operation(classId, 'class.create', {
    class_id: classId, name: '測試班', alias: '測試別名', school_year: '115',
    teacher_name: '測試老師', student_count: count,
    student_ids: Array.from({ length: count }, () => randomUUID()), ...fields,
  })
}

export async function commitClass(client, op = createClass(), actor) {
  const receipt = await submit(client, op, actor)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK', class_seq: 1 })
  const studentIds = op.payload.student_ids
  return { receipt, op, classId: op.class_id, studentIds, studentId: studentIds[0] }
}
