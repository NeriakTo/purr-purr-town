import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { uuidV5 } from '../db-v2/test-support/batch-uuid.js'
import { createClass } from '../db-v2/test-support/class-create.js'
import { addClass, adjustment } from '../db-v2/test-support/operations.js'
import { cancelViaHttp } from './test-support/operation-http.js'
import {
  assertNoOperationTransactions, assertNoOperationWrites, envelope, readOperation, retry, sendOps, serverTime,
  useOpsFixtures,
} from './test-support/ops.js'

function receiptOf(response) {
  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ server_time: serverTime, receipt: expect.any(Object) })
  return response.json().receipt
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('放棄操作', () => {
  const fixture = useOpsFixtures()

  test('登記放棄後同編號提交永遠不成立，再放棄回原收據', async () => {
    const context = fixture()
    const { client, target } = context
    const op = adjustment(target)
    const first = receiptOf(await cancelViaHttp(context, op.op_id))
    expect(first).toMatchObject({ status: 'cancelled', code: 'OP_CANCELLED' })
    expect(first).toEqual((await readOperation(client, op.op_id)).receipt)
    expect(receiptOf(await cancelViaHttp(context, op.op_id))).toEqual({ ...first, replayed: true })
    const response = await sendOps(context, envelope(target.classId, [op]))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0]).toMatchObject({ code: 'OP_CANCELLED' })
    expect((await readOperation(client, op.op_id)).receipt).toEqual(first)
    await assertNoOperationTransactions(client, op.op_id)
  })

  test('放棄已成立或定案拒絕的操作回原收據', async () => {
    const context = fixture()
    const { client, target } = context
    const valid = adjustment(target)
    const invalid = adjustment({ ...target, studentId: randomUUID() })
    const response = await sendOps(context, envelope(target.classId, [valid, invalid]))
    const receipts = response.json().receipts
    expect(receipts.map(receipt => receipt.status)).toEqual(['committed', 'rejected'])
    for (const receipt of receipts) {
      expect(receiptOf(await cancelViaHttp(context, receipt.op_id))).toEqual({ ...receipt, replayed: true })
      expect((await readOperation(client, receipt.op_id)).receipt).toEqual(receipt)
    }
    await assertNoOperationTransactions(client, invalid.op_id)
  })

  test('已存在的小野與別班編號只回 OP_ID_REUSED', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const { ops: [agentOp] } = await ruleBatch(client)
    await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1', [
      agentOp.class_id, teacher.id,
    ])
    const other = await addClass(client, { owner: teacher })
    const otherOp = adjustment(other)
    const response = await sendOps(context, envelope(other.classId, [otherOp]))
    expect(response.json().receipts[0]).toMatchObject({ status: 'committed' })
    for (const op of [agentOp, otherOp]) {
      const before = await readOperation(client, op.op_id)
      const classId = op === agentOp ? agentOp.class_id : target.classId
      expect(receiptOf(await cancelViaHttp(context, op.op_id, classId))).toEqual(retry(op.op_id, 'OP_ID_REUSED'))
      expect(await readOperation(client, op.op_id)).toEqual(before)
    }
  })

  test('未建成的班與別人的班都回相同 403，放棄不新增操作', async () => {
    const context = fixture()
    const { client } = context
    const other = await addClass(client)
    const op = createClass(1, randomUUID(), { name: '' })
    const failed = await sendOps(context, envelope(op.class_id, [op]))
    expect(failed.json().receipts[0]).toMatchObject({ status: 'rejected' })
    const original = await readOperation(client, op.op_id)
    const absent = await cancelViaHttp(context, op.op_id, op.class_id)
    const forbidden = await cancelViaHttp(context, op.op_id, other.classId)
    expect([absent.statusCode, forbidden.statusCode]).toEqual([403, 403])
    expect(absent.rawPayload).toEqual(forbidden.rawPayload)
    expect(absent.json()).toEqual({ error: { code: 'CLASS_FORBIDDEN' } })
    expect(await readOperation(client, op.op_id)).toEqual(original)
    await assertNoOperationTransactions(client, op.op_id)
    const newId = randomUUID()
    expect((await cancelViaHttp(context, newId, other.classId)).statusCode).toBe(403)
    await assertNoOperationWrites(client, newId)
  })

  test('第 5 版編號回 INVALID_OP_ID 且不登記', async () => {
    const context = fixture()
    const opId = uuidV5(context.target.classId, 'cancel-fixture')
    expect(receiptOf(await cancelViaHttp(context, opId))).toEqual(retry(opId, 'INVALID_OP_ID'))
    await assertNoOperationWrites(context.client, opId)
  })

  test('同編號提交與放棄競爭 20 次，各只有一份定案紀錄', async () => {
    const context = fixture()
    const { client, target } = context
    for (let index = 0; index < 20; index++) {
      const op = adjustment(target)
      const commit = () => sendOps(context, envelope(target.classId, [op]))
      const cancel = () => cancelViaHttp(context, op.op_id)
      const [submission, cancellation] = index % 2
        ? (await Promise.all([cancel(), commit()])).reverse()
        : await Promise.all([commit(), cancel()])
      expect(submission.statusCode).toBe(200)
      const submitted = submission.json().receipts[0]
      const cancelled = receiptOf(cancellation)
      const stored = await readOperation(client, op.op_id)
      if (submitted.status === 'committed') {
        expect(stored.receipt).toEqual(submitted)
        expect(cancelled).toEqual({ ...submitted, replayed: true })
      } else {
        expect(cancelled).toMatchObject({ status: 'cancelled', code: 'OP_CANCELLED' })
        expect(stored.receipt).toEqual(cancelled)
        expect(submitted).toMatchObject({ code: 'OP_CANCELLED' })
      }
      const { rowCount } = await client.query('SELECT 1 FROM ppt.transactions WHERE op_id = $1', [op.op_id])
      expect(rowCount).toBe(submitted.status === 'committed' ? 1 : 0)
    }
  }, 10000)
})
