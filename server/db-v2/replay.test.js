import { expect, test } from 'vitest'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('操作重送', () => {
  const db = useTestDatabase()

  test('帳戶已有新版時仍回傳當時保存的收據', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture, 10)
    const first = await submit(client, op)
    const second = await submit(client, adjustment(fixture, -1))
    expect(second.changes[0].value.balance).toBe(9)
    expect(await submit(client, op)).toEqual({ ...first, replayed: true })
    const { rows: [{ receipt }] } = await client.query(
      'SELECT receipt FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    expect(receipt).toEqual(first)
  })

  test('同班換了擁有者也不能重播原操作者的收據', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    expect((await submit(client, op)).status).toBe('committed')
    const newOwner = { kind: 'teacher', id: 'new-teacher-fixture' }
    await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1', [fixture.classId, newOwner.id])
    expect(await submit(client, op, newOwner)).toEqual({
      op_id: op.op_id, status: 'retry', code: 'OP_ID_REUSED',
    })
  })

  test('雜湊保留陣列順序且拒絕收據可原樣重播', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = { ...adjustment(fixture), type: 'test.unknown', payload: [1, 2] }
    const first = await submit(client, op)
    expect(first).toMatchObject({ status: 'rejected', code: 'UNKNOWN_OP_TYPE' })
    expect(await submit(client, op)).toEqual({ ...first, replayed: true })
    expect(await submit(client, { ...op, payload: [2, 1] })).toEqual({
      op_id: op.op_id, status: 'retry', code: 'OP_ID_REUSED',
    })
  })

  test('提交已放棄的同班同操作者編號回已放棄收據', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const { rows: [{ receipt }] } = await client.query(`
      INSERT INTO ppt.operations (op_id, class_id, actor_kind, actor_id, status, code, recorded_at, receipt)
      SELECT $1, class_id, 'teacher', teacher_id, 'cancelled', 'OP_CANCELLED', clock_timestamp(),
             ppt.operation_receipt($1, 'cancelled', 'OP_CANCELLED')
      FROM ppt.class_ownership WHERE class_id = $2
      RETURNING receipt
    `, [op.op_id, fixture.classId])
    expect(await submit(client, op)).toEqual({
      ...receipt, status: 'cancelled', code: 'OP_CANCELLED', replayed: true,
    })
  })
})
