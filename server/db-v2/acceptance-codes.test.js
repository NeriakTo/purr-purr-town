import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, classSequence, operationCount, submit } from './test-support/operations.js'
import { addProduct, purchase } from './test-support/shop.js'
import { addSubmission, addTask, setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function rejectionTarget(client) {
  const fixture = await addClass(client)
  const { classId } = fixture
  const target = { ...fixture, taskId: await addTask(client, classId), productId: await addProduct(client, classId) }
  await addSubmission(client, target)
  await authorizeAgent(client, classId)
  return target
}

async function assertFinalRejection(client, op, code, send) {
  const { class_id: classId, op_id: opId } = op
  const before = await classSnapshot(client, classId)
  const seq = await classSequence(client, classId)
  const count = await operationCount(client)

  const receipt = await send()
  expect(receipt).toMatchObject({ op_id: opId, status: 'rejected', code, replayed: false, class_seq: null })
  const { rows } = await client.query(`
    SELECT code, status, payload, expect, receipt FROM ppt.operations WHERE class_id = $1 AND op_id = $2
  `, [classId, opId])
  expect(rows).toEqual([{ code, status: 'rejected', payload: op.payload, expect: op.expect ?? null, receipt }])
  expect(await classSnapshot(client, classId)).toBe(before)
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, classId)).toBe(seq)

  expect(await send()).toEqual({ ...receipt, replayed: true })
  expect(await classSnapshot(client, classId)).toBe(before)
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, classId)).toBe(seq)
}

async function duplicateItemPurchase(client, target) {
  expect((await submit(client, adjustment(target, 5))).code).toBe('OK')
  const original = purchase(target)
  expect((await submit(client, original)).code).toBe('OK')
  const duplicate = purchase(target, 100)
  duplicate.payload.item_id = original.payload.item_id
  return duplicate
}

const cases = [
  ['UNKNOWN_OP_TYPE', (_client, target) => ({ ...adjustment(target), type: 'unknown.operation' })],
  ['INVALID_PAYLOAD', (_client, target) => adjustment(target, 0)],
  ['FORBIDDEN_ROLE', (_client, target) => purchase(target), true],
  ['SCOPE_FORBIDDEN', (_client, target) => setStatus({ ...target, taskId: randomUUID() }, 'missing'), true],
  ['NOT_FOUND', (_client, target) => purchase({ ...target, productId: randomUUID() })],
  ['ID_CONFLICT', duplicateItemPurchase],
  ['STALE_STATE', (_client, target) => setStatus(target, 'missing', { rev: 8 })],
  ['ENTITY_INACTIVE', async (client, target) => {
    await client.query('UPDATE ppt.products SET disabled = true WHERE class_id = $1', [target.classId])
    return purchase(target)
  }],
  ['CLASS_ARCHIVED', async (client, target) => {
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [target.classId])
    return adjustment(target)
  }],
  ['INSUFFICIENT_BALANCE', (_client, target) => purchase(target)],
  ['OUT_OF_STOCK', async (client, target) => {
    await client.query('UPDATE ppt.products SET stock = 0 WHERE class_id = $1', [target.classId])
    return purchase(target)
  }],
  ['PRICE_CHANGED', (_client, target) => purchase(target, 10)],
]

describeDatabase('錯誤碼逐碼驗收', () => {
  const db = useTestDatabase()

  test.each(cases)('%s 只留一列拒絕，快照與序號不變且重播原收據', async (code, makeOperation, asAgent) => {
    const { client } = db()
    const target = await rejectionTarget(client)
    const op = await makeOperation(client, target)
    const callId = randomUUID()
    async function send() {
      if (!asAgent) return submit(client, op)
      const batch = await agentSubmit(client, target.classId, [op], callId)
      return batch.receipts[0]
    }
    await assertFinalRejection(client, op, code, send)
  })

  test('小野的 call_id 或任一 op_id 用 v5 時整批不登記', async () => {
    const { client } = db()
    const target = await rejectionTarget(client)
    const { classId } = target
    const v5 = '00000000-0000-5000-8000-000000000001'
    const op = setStatus(target, 'missing')
    const snapshot = await classSnapshot(client, classId)
    const count = await operationCount(client)
    const callId = randomUUID()
    expect(await agentSubmit(client, classId, [op], v5))
      .toEqual({ call_id: v5, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await agentSubmit(client, classId, [op, { ...op, op_id: v5 }], callId))
      .toEqual({ call_id: callId, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await agentSubmit(client, classId, [op, { ...op, op_id: undefined }], callId))
      .toEqual({ call_id: callId, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await classSnapshot(client, classId)).toBe(snapshot)
    expect(await operationCount(client)).toBe(count)
    expect(await classSequence(client, classId)).toBe(0)
  })
})
