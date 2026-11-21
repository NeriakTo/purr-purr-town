import { describe, expect, test } from 'vitest'
import { adjustment, submit } from '../db-v2/test-support/operations.js'
import { assignJob, runPayroll, saveJob } from '../db-v2/test-support/payroll.js'
import { createTestClass } from './test-support/fixtures.js'
import { testReadIsolation } from './test-support/read-boundaries.js'
import { commitReadOperation } from './test-support/read-entities.js'
import { readJson } from './test-support/read-json.js'
import { readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'
import { insertReadTransactions, measureReadRequest, prepareReadScale } from './test-support/read-transactions.js'

function encodeTestCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function transactionOrder(client, classId) {
  const { rows } = await client.query(`
    SELECT tx.transaction_id
    FROM ppt.transactions AS tx
    LEFT JOIN ppt.operations AS op ON op.class_id = tx.class_id AND op.op_id = tx.op_id
    WHERE tx.class_id = $1
    ORDER BY coalesce(op.class_seq, 0) DESC, tx.occurred_at DESC, tx.transaction_id COLLATE "C" DESC
  `, [classId])
  return rows.map(row => row.transaction_id)
}

async function finishPages(context, stream, first, options) {
  const items = [...first.items]
  let next = first.next
  const visited = new Set()
  while (next !== null) {
    expect(typeof next).toBe('string')
    expect(visited.has(next)).toBe(false)
    visited.add(next)
    const page = await readJson(context, 'state', { cursor: next }, options)
    expect(Object.keys(page).sort()).toEqual(['class_seq', 'items', 'next', 'server_time', 'stream'])
    expect(page.stream).toBe(stream)
    items.push(...page.items)
    next = page.next
  }
  return items
}

async function addPayrollTransactions(context, target) {
  const { client, teacher } = context
  const job = saveJob(target.classId)
  await commitReadOperation(client, job, teacher)
  await commitReadOperation(client, assignJob(target.classId, job.payload.job_id, target.studentIds), teacher)
  return commitReadOperation(client, runPayroll(target.classId, [job.payload.job_id]), teacher)
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('整班讀取的交易與操作分頁', () => {
  const fixture = useReadFixtures()

  test('1,203 筆交易依三個鍵翻完，保留同序號、同時間與微秒差', async () => {
    const context = fixture()
    const { client, teacher } = context
    const target = await createTestClass(client, { owner: teacher, students: Array(3).fill('enrolled') })
    const branch = { ...context, target }
    await insertReadTransactions(client, { classId: target.classId, studentId: target.studentId }, 1198)
    const payroll = await addPayrollTransactions(context, target)
    for (let index = 0; index < 2; index++) await commitReadOperation(client, adjustment(target), teacher)
    const app = context.makeApp({ config: { read: { pageSize: 500 } } })
    const state = await readJson(branch, 'state', {}, { app })
    expect(state.transactions.items).toHaveLength(500)
    const items = await finishPages(branch, 'transactions', state.transactions, { app })
    const ids = items.map(row => row.transaction_id)
    expect(ids).toHaveLength(1203)
    expect(new Set(ids).size).toBe(1203)
    expect(ids).toEqual(await transactionOrder(client, target.classId))
    const group = items.filter(row => row.class_seq === payroll.class_seq)
    expect(group).toHaveLength(3)
    expect(new Set(group.map(row => row.occurred_at)).size).toBe(1)
    const imported = items.at(-1)
    expect(imported).toMatchObject({ class_seq: null, amount: -1.5, origin: 'migration', op_id: null })
    const { rows: [db] } = await client.query(`
      SELECT to_jsonb(tx) - 'class_id' || jsonb_build_object('class_seq', null) AS item
      FROM ppt.transactions AS tx WHERE class_id = $1 AND transaction_id = $2
    `, [target.classId, imported.transaction_id])
    expect({ ...imported, occurred_at: new Date(imported.occurred_at), effective_at: new Date(imported.effective_at) })
      .toEqual({ ...db.item, occurred_at: new Date(db.item.occurred_at), effective_at: new Date(db.item.effective_at) })
    const tiny = context.makeApp({ config: { read: { pageSize: 3 } } })
    const tinyState = await readJson(branch, 'state', {}, { app: tiny })
    expect(tinyState.transactions.items.at(-1).class_seq).toBe(payroll.class_seq)
    const split = await readJson(branch, 'state', { cursor: tinyState.transactions.next }, { app: tiny })
    expect(split.items.slice(0, 2).map(row => row.transaction_id)).toEqual(ids.slice(3, 5))
  })

  test('交易翻頁途中寫入只出現在第一頁序號之後的增量，舊交易完整', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    await insertReadTransactions(client, target, 6)
    await commitReadOperation(client, adjustment(target), teacher)
    const oldIds = await transactionOrder(client, target.classId)
    const app = context.makeApp({ config: { read: { pageSize: 2 } } })
    const first = await readJson(context, 'state', {}, { app })
    const op = adjustment(target, 13)
    const receipt = await commitReadOperation(client, op, teacher)
    const rows = await finishPages(context, 'transactions', first.transactions, { app })
    expect(rows.map(row => row.transaction_id)).toEqual(oldIds)
    const changes = await readJson(context, 'changes', { since_seq: first.class_seq }, { app })
    expect(changes.transactions).toMatchObject([{ transaction_id: receipt.result.transactions[0], op_id: op.op_id }])
  })

  test('操作串流只帶成立項目與指定八欄，翻頁途中新操作由增量補回', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const committed = []
    for (let index = 0; index < 5; index++) {
      const op = { ...adjustment(target), client_time: '2026-11-21T08:00:00Z' }
      await commitReadOperation(client, op, teacher)
      committed.push(op)
    }
    expect((await submit(client, adjustment({ ...target, studentId: '測試缺學生' }), teacher)).status).toBe('rejected')
    const app = context.makeApp({ config: { read: { pageSize: 2 } } })
    const first = await readJson(context, 'state', {}, { app })
    expect(first.operations.items).toHaveLength(2)
    const newOp = adjustment(target, 17)
    await commitReadOperation(client, newOp, teacher)
    const items = await finishPages(context, 'operations', first.operations, { app })
    expect(items).toEqual(committed.toReversed().map((op, index) => ({
      op_id: op.op_id, type: op.type, actor_kind: 'teacher', class_seq: 5 - index,
      committed_at: expect.any(String), batch_id: null, client_time: op.client_time, payload: op.payload,
    })))
    const changes = await readJson(context, 'changes', { since_seq: first.class_seq }, { app })
    expect(changes.operations).toMatchObject([{ op_id: newOp.op_id, class_seq: 6 }])
  })

  test.each([
    ['本文中的非字串', 42],
    ['亂字串', '亂字串+?'],
    ['有尾填補的 base64url', encodeTestCursor({ stream: 'operations', key: [12] }) + '='],
    ['未知串流', encodeTestCursor({ stream: 'classes', key: [12] })],
    ['序號是字串', encodeTestCursor({ stream: 'operations', key: ['12'] })],
    ['序號小於零', encodeTestCursor({ stream: 'transactions', key: [-1, '2026-11-01T00:00:00+00:00', 'x'] })],
    ['無效交易時間', encodeTestCursor({ stream: 'transactions', key: [0, '2026-02-30T00:00:00+00:00', 'x'] })],
    ['交易時間早於 PostgreSQL 範圍', encodeTestCursor({ stream: 'transactions', key: [0, '4714-11-23T23:59:59+00:00 BC', 'x'] })],
    ['交易編號是數字', encodeTestCursor({ stream: 'transactions', key: [0, '2026-11-01T00:00:00+00:00', 12] })],
    ['游標偷帶班級', encodeTestCursor({ stream: 'operations', key: [12], class_id: '測試班級' })],
  ])('游標的%s回 BAD_ENVELOPE，且先於班級檢查', async (_label, cursor) => {
    const context = fixture()
    const before = await readWriteBaseline(context.client)
    for (const class_id of [context.target.classId, '測試缺班']) {
      const response = await sendRead(context, 'state', { class_id, cursor })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    }
    expect(await readWriteBaseline(context.client)).toEqual(before)
  })

  test('甲班游標只有排序鍵，帶到乙班只查本文所在班級', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const other = await createTestClass(client, { owner: teacher })
    const ownReceipt = await commitReadOperation(client, adjustment(target, 11), teacher)
    await commitReadOperation(client, adjustment(target, 12), teacher)
    const otherReceipt = await commitReadOperation(client, adjustment(other, 21), teacher)
    const app = context.makeApp({ config: { read: { pageSize: 1 } } })
    const first = await readJson(context, 'state', {}, { app })
    const next = first.transactions.next
    expect(JSON.parse(Buffer.from(next, 'base64url'))).toEqual({
      stream: 'transactions', key: [2, expect.any(String), expect.any(String)],
    })
    const body = await readJson({ ...context, target: other }, 'state', { cursor: next }, { app })
    expect(body).toMatchObject({
      stream: 'transactions', next: null, items: [{ transaction_id: otherReceipt.result.transactions[0], amount: 21 }],
    })
    expect(JSON.stringify(body)).not.toContain(ownReceipt.result.transactions[0])
  })

  test.each([0, 2001, 0.5, '500', null])('pageSize 設定 %s 不合法時拒絕建立 app', value => {
    expect(() => fixture().makeApp({ config: { read: { pageSize: value } } })).toThrow(RangeError)
  })

  test('30 位學生、1,200 筆交易量測整班與一頁交易，預設每頁 500 筆', async () => {
    const context = fixture()
    const target = await prepareReadScale(context)
    const response = await measureReadRequest('整班讀取', () => sendRead(context, 'state', { class_id: target.classId }))
    expect(response.statusCode).toBe(200)
    const first = response.json()
    expect(first.transactions.items).toHaveLength(500)
    expect(first.rows.filter(row => row.entity === 'student')).toHaveLength(30)
    expect(first.operations.items).toHaveLength(1)
    expect(first.legacy_effects).toHaveLength(1)
    expect(first.legacy_effects[0].candidates).toHaveLength(40)
    expect(first.payroll).toHaveLength(3)
    expect(first.agent_batches).toHaveLength(1)
    const next = await measureReadRequest('一頁交易', () => sendRead(context, 'state', {
      class_id: target.classId, cursor: first.transactions.next,
    }))
    expect(next.statusCode).toBe(200)
    expect(next.json().items).toHaveLength(500)
  })
})

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('分頁的班級隔離', () => {
  const fixture = useReadFixtures()
  for (const stream of ['transactions', 'operations']) {
    function makeRequest(context, cursor) {
      return sendRead(context, 'state', { class_id: context.target.classId, cursor })
    }
    async function prepare(context) {
      const { client, target, teacher } = context
      await insertReadTransactions(client, target, 1)
      for (let index = 0; index < 3; index++) await commitReadOperation(client, adjustment(target), teacher)
      const app = context.makeApp({ config: { read: { pageSize: 1 } } })
      const state = await readJson(context, 'state', {}, { app })
      expect(state[stream].next).toEqual(expect.any(String))
      return state[stream].next
    }
    testReadIsolation(fixture, stream + ' 游標', makeRequest, prepare)
  }
})
