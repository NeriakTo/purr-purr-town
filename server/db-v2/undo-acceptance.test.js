import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { adjustment, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { markSubmission } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { transactionFrom } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'
import {
  effectRow, expectSubmissionState, lateEvent, missingEvent, setupSubmissionUndo,
} from './test-support/undo-submissions.js'

const startingBalance = 100

async function fundSubmissionUndo(client) {
  const { target } = await setupSubmissionUndo(client)
  await commitOperation(client, adjustment(target, startingBalance))
  return target
}

async function rejectWithoutChanges(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}

describeDatabase('撤銷甲段驗收', () => {
  const database = useTestDatabase()

  test('S1 連續撤銷先補回接替效果，再沖回該效果並回到原點', async () => {
    const { client } = database()
    const target = await fundSubmissionUndo(client)
    await expectSubmissionState(client, target, 1, 1, 'pending', startingBalance)

    const late = await markSubmission(client, target, 'late')
    const [original] = late.result.effects_added
    await expectSubmissionState(client, target, 2, 2, 'late', 90, [[lateEvent, -10]])

    const missing = await markSubmission(client, target, 'missing', 2)
    expect(missing.result.effects_reversed).toMatchObject([{ effect_id: original.effect_id, effective_amount: -10 }])
    await expectSubmissionState(client, target, 3, 3, 'missing', 80, [[missingEvent, -20]])

    const undoMissing = await commitOperation(client, undo(target.classId, missing.op_id))
    const [restored] = undoMissing.result.effects_added
    expect(restored).toMatchObject({ event: lateEvent, amount: -10, lineage_id: original.lineage_id })
    expect(restored.effect_id).not.toBe(original.effect_id)
    await expectSubmissionState(client, target, 4, 2, 'late', 90, [[lateEvent, -10]])

    const undoLate = await commitOperation(client, undo(target.classId, late.op_id))
    expect(undoLate.result.effects_reversed).toMatchObject([{ effect_id: restored.effect_id, effective_amount: -10 }])
    expect(await transactionFrom(client, undoLate)).toMatchObject({
      amount: '10', root_transaction_id: restored.root_transaction_id,
    })
    expect(undoLate.warnings).toEqual([])
    expect(undoLate.result.undo).toEqual({ target_op_id: late.op_id, skipped: [], amount_changed: [] })
    await expectSubmissionState(client, target, 5, 1, 'pending', startingBalance)
  })

  test('S3 兩次補交各自保留前基準，撤銷三筆後回到原點', async () => {
    const { client } = database()
    const target = await fundSubmissionUndo(client)
    const deduction = [[missingEvent, -20]]
    await expectSubmissionState(client, target, 1, 1, 'pending', startingBalance)

    const missing = await markSubmission(client, target, 'missing')
    const [original] = missing.result.effects_added
    await expectSubmissionState(client, target, 2, 2, 'missing', 80, deduction)

    const firstMakeup = await markSubmission(client, target, 'makeup', 2)
    await expectSubmissionState(client, target, 3, 3, 'makeup', 80, deduction)

    const undoFirst = await commitOperation(client, undo(target.classId, firstMakeup.op_id))
    expect(undoFirst.result.transactions).toEqual([])
    await expectSubmissionState(client, target, 4, 2, 'missing', 80, deduction)

    const secondMakeup = await markSubmission(client, target, 'makeup', 4)
    expect(secondMakeup.changes[0]).toMatchObject({ prev_rev: 4, prev_basis_rev: 2, rev: 5, basis_rev: 5 })
    await expectSubmissionState(client, target, 5, 5, 'makeup', 80, deduction)

    const undoSecond = await commitOperation(client, undo(target.classId, secondMakeup.op_id))
    expect(undoSecond.result.transactions).toEqual([])
    await expectSubmissionState(client, target, 6, 2, 'missing', 80, deduction)
    expect(await effectRow(client, target.classId, original.effect_id)).toMatchObject({ status: 'active' })

    const undoMissing = await commitOperation(client, undo(target.classId, missing.op_id))
    expect(undoMissing.result.effects_reversed).toMatchObject([{ effect_id: original.effect_id, effective_amount: -20 }])
    await expectSubmissionState(client, target, 7, 1, 'pending', startingBalance)
  })

  test('16.3 第 3 條回到同值仍有新基準，不能撤第一筆缺交', async () => {
    const { client } = database()
    const target = await fundSubmissionUndo(client)
    const first = await markSubmission(client, target, 'missing')
    await markSubmission(client, target, 'on_time', 2)
    const last = await markSubmission(client, target, 'missing', 3)
    expect(last.changes[0].value).toEqual(first.changes[0].value)

    const rejected = await rejectWithoutChanges(client, undo(target.classId, first.op_id), 'UNDO_CONFLICT')
    expect(rejected.current).toMatchObject({ reason: 'basis_changed', rev: 4, basis_rev: 4, last_op_id: last.op_id })
    await expectSubmissionState(client, target, 4, 4, 'missing', 80, [[missingEvent, -20]])
  })

  test('16.1 拒絕只保存一列，排除衝突後可撤一次', async () => {
    const { client } = database()
    const target = await fundSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    const late = await markSubmission(client, target, 'late', 2)
    const rejectedOp = undo(target.classId, missing.op_id)

    const rejected = await rejectWithoutChanges(client, rejectedOp, 'UNDO_CONFLICT')
    expect(rejected.current.reason).toBe('basis_changed')
    const { rows } = await client.query(`
      SELECT op_id, status, code, class_seq FROM ppt.operations
      WHERE class_id = $1 AND type = 'op.undo' AND payload->>'target_op_id' = $2
    `, [target.classId, missing.op_id])
    expect(rows).toEqual([{ op_id: rejectedOp.op_id, status: 'rejected', code: 'UNDO_CONFLICT', class_seq: null }])

    await commitOperation(client, undo(target.classId, late.op_id))
    await expectSubmissionState(client, target, 4, 2, 'missing', 80, [[missingEvent, -20]])
    await commitOperation(client, undo(target.classId, missing.op_id))
    await expectSubmissionState(client, target, 5, 1, 'pending', startingBalance)
    await rejectWithoutChanges(client, undo(target.classId, missing.op_id), 'ALREADY_UNDONE')
  })
})
