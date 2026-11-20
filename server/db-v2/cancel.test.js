import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, cancel, operationCount, submit, teacher } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('放棄操作', () => {
  const db = useTestDatabase()

  test('封存班也能放棄新編號，原列不存輸入或雜湊', async () => {
    const { client } = db()
    const fixture = await addClass(client, { status: 'archived' })
    const op = adjustment(fixture)
    const before = await classSnapshot(client, fixture.classId)
    const receipt = await cancel(client, fixture.classId, op.op_id)
    expect(receipt).toMatchObject({
      op_id: op.op_id, status: 'cancelled', code: 'OP_CANCELLED',
      class_seq: null, committed_at: null, replayed: false,
    })
    const { rows: [row] } = await client.query(`
      SELECT receipt, type, payload, expect, content_hash, actor_id
      FROM ppt.operations WHERE op_id = $1
    `, [op.op_id])
    expect(row).toEqual({
      receipt, type: null, payload: null, expect: null, content_hash: null, actor_id: teacher.id,
    })
    expect(await cancel(client, fixture.classId, op.op_id)).toEqual({ ...receipt, replayed: true })
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test('同班同操作者放棄已成立或已拒絕的編號會回原收據', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    for (const [amount, status] of [[5, 'committed'], [0, 'rejected']]) {
      const op = adjustment(fixture, amount)
      const submitted = await submit(client, op)
      expect(submitted.status).toBe(status)
      expect(await cancel(client, fixture.classId, op.op_id)).toEqual({ ...submitted, replayed: true })
    }
  })

  test('放棄別班或別的操作者的編號只回 OP_ID_REUSED', async () => {
    const { client } = db()
    const firstClass = await addClass(client)
    const secondClass = await addClass(client)
    const op = adjustment(firstClass)
    await submit(client, op)
    const expected = { op_id: op.op_id, status: 'retry', code: 'OP_ID_REUSED' }
    expect(await cancel(client, secondClass.classId, op.op_id)).toEqual(expected)
    const newOwner = { kind: 'teacher', id: 'other-teacher-fixture' }
    await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1',
      [firstClass.classId, newOwner.id])
    expect(await cancel(client, firstClass.classId, op.op_id, newOwner)).toEqual(expected)
  })

  test('放棄無權存取或不存在班級的操作時不登記編號', async () => {
    const { client } = db()
    const fixture = await addClass(client, { owner: { kind: 'teacher', id: 'other-teacher-fixture' } })
    const { op_id: opId } = adjustment(fixture)
    const count = await operationCount(client)
    const expected = { op_id: opId, status: 'retry', code: 'CLASS_FORBIDDEN' }
    expect(await cancel(client, fixture.classId, opId)).toEqual(expected)
    expect(await cancel(client, 'missing-class', opId)).toEqual(expected)
    expect(await operationCount(client)).toBe(count)
  })
})

