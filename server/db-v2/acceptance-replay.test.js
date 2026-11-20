import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, cancel, operationCount, submit } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function transactionCount(client, opId) {
  const { rows: [{ count }] } = await client.query(
    'SELECT count(*)::int AS count FROM ppt.transactions WHERE op_id = $1', [opId],
  )
  return count
}

function reusedReceipt(opId) {
  return { op_id: opId, status: 'retry', code: 'OP_ID_REUSED' }
}

function afterSubmitWins(submitted, cancelled) {
  expect(submitted).toMatchObject({ status: 'committed', code: 'OK', replayed: false })
  expect(cancelled).toEqual({ ...submitted, replayed: true })
}

function afterCancelWins(submitted, cancelled) {
  expect(cancelled).toMatchObject({ status: 'cancelled', code: 'OP_CANCELLED', replayed: false })
  expect(submitted).toEqual({ ...cancelled, replayed: true })
}

describeDatabase('重送與放棄驗收', () => {
  const db = useTestDatabase()

  test('順序重送三次及兩連線重送各只寫入一筆交易', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client)
    const op = {
      ...adjustment(fixture), batch_id: 'batch-a', client_time: '2026-11-21T00:00:00Z', client_seq: 1,
    }
    const first = await submit(client, op)
    expect(first).toMatchObject({ status: 'committed', replayed: false })
    const reordered = JSON.stringify({
      client_seq: 2, client_time: '2026-11-21T00:01:00Z', batch_id: 'batch-b',
      payload: { amount: op.payload.amount, student_id: op.payload.student_id },
      class_id: op.class_id, type: op.type, op_id: op.op_id,
    }, null, 2)
    expect(await submit(client, reordered)).toEqual({ ...first, replayed: true })
    expect(await submit(client, op)).toEqual({ ...first, replayed: true })
    expect(await transactionCount(client, op.op_id)).toBe(1)
    const { rows: [metadata] } = await client.query(
      'SELECT batch_id, client_time, client_seq FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    expect(metadata).toEqual({ batch_id: op.batch_id, client_time: op.client_time, client_seq: op.client_seq })

    const concurrent = adjustment(fixture)
    const other = await connect()
    const receipts = await Promise.all([submit(client, concurrent), submit(other, concurrent)])
    expect(receipts.map((receipt) => receipt.replayed).sort()).toEqual([false, true])
    const original = receipts.find((receipt) => !receipt.replayed)
    expect(original.status).toBe('committed')
    expect(receipts.find((receipt) => receipt.replayed)).toEqual({ ...original, replayed: true })
    expect(await transactionCount(client, concurrent.op_id)).toBe(1)
  })

  test('同編號改內容或改班只回三欄且雙班同搶只成立一筆', async () => {
    const { client, connect } = db()
    const left = await addClass(client)
    const right = await addClass(client)
    const op = adjustment(left)
    const original = await submit(client, op)
    const leftBefore = await classSnapshot(client, left.classId)
    const rightBefore = await classSnapshot(client, right.classId)
    const count = await operationCount(client)
    expect(await submit(client, { ...op, payload: { ...op.payload, amount: 9 } })).toEqual(reusedReceipt(op.op_id))
    expect(await submit(client, { ...adjustment(right), op_id: op.op_id })).toEqual(reusedReceipt(op.op_id))
    expect(await classSnapshot(client, left.classId)).toBe(leftBefore)
    expect(await classSnapshot(client, right.classId)).toBe(rightBefore)
    expect(await operationCount(client)).toBe(count)
    expect(await submit(client, op)).toEqual({ ...original, replayed: true })

    const first = adjustment(left)
    const second = { ...adjustment(right), op_id: first.op_id }
    const other = await connect()
    const receipts = await Promise.all([submit(client, first), submit(other, second)])
    expect(receipts.map((receipt) => receipt.status).sort()).toEqual(['committed', 'retry'])
    expect(receipts.find((receipt) => receipt.status === 'retry')).toEqual(reusedReceipt(first.op_id))
    expect(await operationCount(client)).toBe(count + 1)
    expect(await transactionCount(client, first.op_id)).toBe(1)
  })

  test('兩連線競爭提交與放棄一百次，每次只有一個原收據', async () => {
    const { client, connect } = db()
    const submitter = await connect()
    const canceller = await connect()
    const fixture = await addClass(client)
    const counts = { submitted: 0, cancelled: 0 }
    for (let i = 0; i < 100; i += 1) {
      const op = adjustment(fixture)
      const actions = [
        () => submit(submitter, op),
        () => cancel(canceller, fixture.classId, op.op_id),
      ]
      // Alternate which connection queues first and await both only after starting both.
      if (i % 2 === 1) actions.reverse()
      const receipts = await Promise.all(actions.map((action) => action()))
      const [submitted, cancelled] = i % 2 === 1 ? receipts.reverse() : receipts
      if (submitted.status === 'committed') {
        afterSubmitWins(submitted, cancelled)
        counts.submitted += 1
      } else {
        afterCancelWins(submitted, cancelled)
        counts.cancelled += 1
      }
    }
    const { rows: [actual] } = await client.query(`
      SELECT
        (SELECT count(*)::int FROM ppt.operations WHERE class_id = $1 AND status = 'committed') AS submitted,
        (SELECT count(*)::int FROM ppt.operations WHERE class_id = $1 AND status = 'cancelled') AS cancelled,
        (SELECT count(*)::int FROM ppt.transactions WHERE class_id = $1) AS transactions
    `, [fixture.classId])
    expect(actual).toEqual({ ...counts, transactions: counts.submitted })
    console.log(`03:373 提交先成立 ${counts.submitted} 次，放棄先成立 ${counts.cancelled} 次`)
  }, 30000)

  test('固定提交先到，放棄重播成立收據', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const other = await connect()
    const submitted = await submit(client, op)
    const cancelled = await cancel(other, fixture.classId, op.op_id)
    afterSubmitWins(submitted, cancelled)
    expect(await transactionCount(client, op.op_id)).toBe(1)
  })

  test('固定放棄先到，提交回 OP_CANCELLED', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const other = await connect()
    const cancelled = await cancel(other, fixture.classId, op.op_id)
    const submitted = await submit(client, op)
    afterCancelWins(submitted, cancelled)
    expect(await transactionCount(client, op.op_id)).toBe(0)
  })
})
