import { describe, expect, test } from 'vitest'
import { adjustment, classSequence } from '../db-v2/test-support/operations.js'
import { createTask } from '../db-v2/test-support/schoolwork.js'
import { addSubmission, addTask, setStatus, submissionRow } from '../db-v2/test-support/submissions.js'
import {
  assertNoOperationTransactions, assertNoOperationWrites, envelope, readOperation, retry, sendOps, serverTime,
  useOpsFixtures,
} from './test-support/ops.js'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('提交操作與收據', () => {
  const fixture = useOpsFixtures()

  test('OP-24 原樣回傳已保存的收據並只寫一筆交易', async () => {
    const context = fixture()
    const { client, target } = context
    const op = adjustment(target, 12)
    const response = await sendOps(context, envelope(target.classId, [op]))
    expect(response.statusCode).toBe(200)
    const { receipt } = await readOperation(client, op.op_id)
    expect(receipt).toMatchObject({ op_id: op.op_id, status: 'committed', code: 'OK' })
    expect(response.json()).toEqual({ server_time: serverTime, class_seq: 1, receipts: [receipt] })
    const { rows: accounts } = await client.query(
      'SELECT student_id, balance FROM ppt.accounts WHERE class_id = $1', [target.classId],
    )
    expect(accounts).toEqual([{ student_id: target.studentId, balance: '12' }])
    const { rows: transactions } = await client.query(
      'SELECT op_id, student_id, amount FROM ppt.transactions WHERE class_id = $1', [target.classId],
    )
    expect(transactions).toEqual([{ op_id: op.op_id, student_id: target.studentId, amount: '12' }])
  })

  test('OP-14 的 after_op 可接同一請求內先提交的 OP-10', async () => {
    const context = fixture()
    const { client, target } = context
    const create = createTask(target.classId)
    const submission = { ...target, taskId: create.payload.task_id }
    const update = setStatus(submission, 'on_time', { after_op: create.op_id })
    const response = await sendOps(context, envelope(target.classId, [create, update]))
    expect(response.statusCode).toBe(200)
    const { class_seq: seq, receipts } = response.json()
    expect(receipts.map(({ op_id, status, class_seq }) => [op_id, status, class_seq])).toEqual([
      [create.op_id, 'committed', 1], [update.op_id, 'committed', 2],
    ])
    expect(await submissionRow(client, submission)).toMatchObject({ status: 'on_time', last_op_id: update.op_id })
    expect(seq).toBe(await classSequence(client, target.classId))
  })

  test('請求可省略 batch_id 或帶 null，非空字串則存到操作紀錄', async () => {
    const context = fixture()
    const { client, target } = context
    for (const fields of [{}, { batch_id: null }, { batch_id: '測試批次' }]) {
      const op = adjustment(target)
      const response = await sendOps(context, envelope(target.classId, [op], fields))
      expect(response.statusCode).toBe(200)
      expect(response.json().receipts[0]).toMatchObject({ status: 'committed' })
      expect(await readOperation(client, op.op_id)).toMatchObject({ batch_id: fields.batch_id ?? null })
    }
  })

  test('累加型保留 expect 是否出現，只有明帶 null 的操作被定案拒絕', async () => {
    const context = fixture()
    const { client, target } = context
    const first = adjustment(target)
    const second = { ...adjustment(target), expect: null }
    const response = await sendOps(context, envelope(target.classId, [first, second]))
    expect(response.statusCode).toBe(200)
    const { receipts } = response.json()
    expect(receipts.map(({ status, code }) => [status, code])).toEqual([
      ['committed', 'OK'], ['rejected', 'INVALID_PAYLOAD'],
    ])
    expect(await readOperation(client, second.op_id)).toMatchObject({ receipt: receipts[1], class_seq: null })
    await assertNoOperationTransactions(client, second.op_id)
  })

  test('同一本文重送只成立一次，第二份收據只改 replayed', async () => {
    const context = fixture()
    const { client, target } = context
    const op = adjustment(target)
    const body = JSON.stringify(envelope(target.classId, [op]))
    const first = await sendOps(context, body)
    const second = await sendOps(context, body)
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    const { receipts } = first.json()
    expect(receipts[0]).toMatchObject({ status: 'committed', replayed: false })
    expect(second.json().receipts).toEqual(receipts.map(receipt => ({ ...receipt, replayed: true })))
    const { rowCount } = await client.query('SELECT 1 FROM ppt.transactions WHERE class_id = $1', [target.classId])
    expect(rowCount).toBe(1)
    expect(await classSequence(client, target.classId)).toBe(1)
  })

  test('同一 rev 先到成立，後到回原樣的 STALE_STATE current', async () => {
    const context = fixture()
    const { client, target } = context
    const submission = { ...target, taskId: await addTask(client, target.classId) }
    await addSubmission(client, submission)
    const first = setStatus(submission, 'on_time', { rev: 1 })
    const second = setStatus(submission, 'late', { rev: 1 })
    const accepted = await sendOps(context, envelope(target.classId, [first]))
    const rejected = await sendOps(context, envelope(target.classId, [second]))
    expect(accepted.statusCode).toBe(200)
    expect(rejected.statusCode).toBe(200)
    expect(accepted.json().receipts[0]).toMatchObject({ status: 'committed' })
    const { receipt } = await readOperation(client, second.op_id)
    expect(receipt).toMatchObject({
      status: 'rejected', code: 'STALE_STATE',
      current: { rev: 2, last_op_id: first.op_id, actor: context.teacher, value: { status: 'on_time' } },
    })
    expect(rejected.json().receipts).toEqual([receipt])
    await assertNoOperationTransactions(client, second.op_id)
    expect(await submissionRow(client, submission)).toMatchObject({ status: 'on_time', rev: 2 })
  })

  test('第 5 版編號回 INVALID_OP_ID，前後操作均成立', async () => {
    const context = fixture()
    const { client, target } = context
    const ops = Array.from({ length: 3 }, () => adjustment(target))
    ops[1].op_id = ops[1].op_id.slice(0, 14) + '5' + ops[1].op_id.slice(15)
    const response = await sendOps(context, envelope(target.classId, ops))
    expect(response.statusCode).toBe(200)
    const { receipts } = response.json()
    expect(receipts.map(({ status }) => status)).toEqual(['committed', 'retry', 'committed'])
    expect(receipts[1]).toEqual(retry(ops[1].op_id, 'INVALID_OP_ID'))
    await assertNoOperationWrites(client, ops[1].op_id)
    expect(await classSequence(client, target.classId)).toBe(2)
  })

  test('單筆 BAD_ENVELOPE 和 OP_ID_REUSED 都不阻斷後續操作', async () => {
    const context = fixture()
    const { client, target } = context
    const previous = adjustment(target, 1)
    const setup = await sendOps(context, envelope(target.classId, [previous]))
    expect(setup.statusCode).toBe(200)
    expect(setup.json().receipts[0]).toMatchObject({ status: 'committed' })
    const malformed = { ...adjustment(target), payload: { pad: 'a'.repeat(64 * 1024 - 10) } }
    // JSONB 在冒號後加空白，JS 端剛好符合上限的 payload 會由寫入程序回單筆錯誤。
    expect(Buffer.byteLength(JSON.stringify(malformed.payload), 'utf8')).toBe(64 * 1024)
    const reused = { ...previous, payload: { ...previous.payload, amount: 2 } }
    const next = adjustment(target)
    const response = await sendOps(context, envelope(target.classId, [malformed, reused, next]))
    expect(response.statusCode).toBe(200)
    const { receipts } = response.json()
    expect(receipts.slice(0, 2)).toEqual([
      retry(malformed.op_id, 'BAD_ENVELOPE'), retry(reused.op_id, 'OP_ID_REUSED'),
    ])
    expect(receipts[2]).toMatchObject({ op_id: next.op_id, status: 'committed' })
    await assertNoOperationWrites(client, malformed.op_id)
    expect((await readOperation(client, reused.op_id)).receipt).toEqual(setup.json().receipts[0])
    const { rowCount } = await client.query('SELECT 1 FROM ppt.transactions WHERE class_id = $1', [target.classId])
    expect(rowCount).toBe(2)
  })
})
