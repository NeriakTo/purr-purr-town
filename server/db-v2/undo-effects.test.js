import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, restoreTask, voidTask } from './test-support/schoolwork.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { addLegacyTransaction, correct, reverse, transactionFrom } from './test-support/transactions.js'
import { setupEffectConflict } from './test-support/undo-effects.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { effectRow, expectSubmissionState, lateEvent, missingEvent, setupSubmissionUndo } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

function undoReceipt(client, { classId }, receipt) {
  return commitOperation(client, undo(classId, receipt.op_id))
}

function expectManualWarning(receipt, changeCase, original, rootId, lastOpId, amount) {
  const details = {
    effect_id: original.effect_id, lineage_id: original.lineage_id,
    transaction_id: rootId, changed_by_op_id: lastOpId, original_amount: original.amount, amount,
  }
  expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: changeCase, ...details }])
  expect(receipt.result.undo).toMatchObject({
    skipped: changeCase === 'already_reversed' ? [details] : [],
    amount_changed: changeCase === 'amount_changed' ? [details] : [],
  })
}

async function assertZeroReversal(client, classId, receipt, rootId) {
  expect(receipt.result.transactions).toHaveLength(1)
  expect(await transactionFrom(client, receipt)).toMatchObject({
    kind: 'reversal', root_transaction_id: rootId, amount: '0', earned_delta: '0',
  })
  const { rows } = await client.query(`
    SELECT transaction_id FROM ppt.transactions WHERE class_id = $1 AND root_transaction_id = $2 AND kind = 'reversal'
  `, [classId, rootId])
  expect(rows).toEqual([{ transaction_id: receipt.result.transactions[0] }])
  expect((await submit(client, correct(classId, rootId, 0, -1))).code).toBe('TX_ALREADY_REVERSED')
  expect((await submit(client, reverse(classId, rootId, 0))).code).toBe('TX_ALREADY_REVERSED')
}

describeDatabase('撤銷寬做法與效果存摺', () => {
  const db = useTestDatabase()

  test('16.3 第 1 條撤補交後人工已退缺交，撤缺交只回復狀態', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    const [effect] = missing.result.effects_added
    const makeup = await markSubmission(client, target, 'makeup', 2)
    await undoReceipt(client, target, makeup)
    await expectSubmissionState(client, target, 4, 2, 'missing', -20, [[missingEvent, -20]])
    const reversed = await commitOperation(client, reverse(target.classId, effect.root_transaction_id, -20))
    await expectSubmissionState(client, target, 4, 2, 'missing', 0)
    const receipt = await undoReceipt(client, target, missing)
    expect(receipt.result).toMatchObject({ noop: false, transactions: [], effects_reversed: [] })
    expectManualWarning(receipt, 'already_reversed', effect, effect.root_transaction_id, reversed.op_id, null)
    await expectSubmissionState(client, target, 5, 1, 'pending', 0)
  })

  test('16.3 第 2 條依快照補回改過的扣分，再按補回金額結束接替鏈', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const late = await markSubmission(client, target, 'late')
    const [effect] = late.result.effects_added
    await commitOperation(client, correct(target.classId, effect.root_transaction_id, -10, -6))
    await expectSubmissionState(client, target, 2, 2, 'late', -6, [[lateEvent, -6]])
    const missing = await markSubmission(client, target, 'missing', 2)
    expect(missing.result.effects_reversed).toMatchObject([{ effect_id: effect.effect_id, effective_amount: -6 }])
    await expectSubmissionState(client, target, 3, 3, 'missing', -20, [[missingEvent, -20]])
    const undoMissing = await undoReceipt(client, target, missing)
    const [restored] = undoMissing.result.effects_added
    expect(restored).toMatchObject({ amount: -6, lineage_id: effect.lineage_id })
    await expectSubmissionState(client, target, 4, 2, 'late', -6, [[lateEvent, -6]])
    const receipt = await undoReceipt(client, target, late)
    expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '6', root_transaction_id: restored.root_transaction_id })
    expectManualWarning(receipt, 'amount_changed', effect, restored.root_transaction_id, null, -6)
    await expectSubmissionState(client, target, 5, 1, 'pending', 0)
  })

  test('16.3 第 7 條撤遲交按改過的金額沖回，後續撤更正被擋', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const late = await markSubmission(client, target, 'late')
    const [effect] = late.result.effects_added
    const fixed = await commitOperation(client, correct(target.classId, effect.root_transaction_id, -10, -8))
    await expectSubmissionState(client, target, 2, 2, 'late', -8, [[lateEvent, -8]])
    const receipt = await undoReceipt(client, target, late)
    expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '8' })
    expectManualWarning(receipt, 'amount_changed', effect, effect.root_transaction_id, fixed.op_id, -8)
    const rejected = await rejectUndoWithoutChanges(client, undo(target.classId, fixed.op_id), 'UNDO_CONFLICT')
    expect(rejected.current).toMatchObject({ reason: 'tx_changed_later', reversed: true, last_op_id: receipt.op_id })
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
  })

  test('16.3 第 9 條恢復作業後能撤缺交，作廢已退的扣分只提示', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const { classId, taskId } = target
    const missing = await markSubmission(client, target, 'missing')
    const [effect] = missing.result.effects_added
    const voided = await commitOperation(client, voidTask(classId, taskId, true))
    await expectSubmissionState(client, target, 2, 2, 'missing', 0)
    await rejectUndoWithoutChanges(client, undo(classId, missing.op_id), 'ENTITY_INACTIVE')
    await commitOperation(client, restoreTask(classId, taskId))
    const receipt = await undoReceipt(client, target, missing)
    expect(receipt.result.transactions).toEqual([])
    expectManualWarning(receipt, 'already_reversed', effect, effect.root_transaction_id, voided.op_id, null)
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
  })

  test('03:429 ② 補回的遲交扣分改成零，撤遲交會結束效果並寫唯一沖回', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const { classId } = target
    const late = await markSubmission(client, target, 'late')
    await expectSubmissionState(client, target, 2, 2, 'late', -10, [[lateEvent, -10]])
    const missing = await markSubmission(client, target, 'missing', 2)
    await expectSubmissionState(client, target, 3, 3, 'missing', -20, [[missingEvent, -20]])
    const undoMissing = await undoReceipt(client, target, missing)
    const [restored] = undoMissing.result.effects_added
    await expectSubmissionState(client, target, 4, 2, 'late', -10, [[lateEvent, -10]])
    const fixed = await commitOperation(client, correct(classId, restored.root_transaction_id, -10, 0))
    await expectSubmissionState(client, target, 4, 2, 'late', 0, [[lateEvent, 0]])
    const receipt = await undoReceipt(client, target, late)
    expectManualWarning(receipt, 'amount_changed', late.result.effects_added[0], restored.root_transaction_id, fixed.op_id, 0)
    expect(await effectRow(client, classId, restored.effect_id)).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
    await expectSubmissionState(client, target, 5, 1, 'pending', 0)
    await assertZeroReversal(client, classId, receipt, restored.root_transaction_id)
  })

  test('03:429 ③ 新建缺交扣分改成零，撤新建回到不參與且不留有效效果', async () => {
    const { client } = db()
    const original = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const target = await assignTask(client, original, { assignee_ids: [original.studentIds[1]] })
    const { classId } = target
    await saveEventRule(client, classId, missingEvent, -20)
    const missing = await markSubmission(client, target, 'missing', 0)
    const [effect] = missing.result.effects_added
    await expectSubmissionState(client, target, 1, 1, 'missing', -20, [[missingEvent, -20]])
    const fixed = await commitOperation(client, correct(classId, effect.root_transaction_id, -20, 0))
    await expectSubmissionState(client, target, 1, 1, 'missing', 0, [[missingEvent, 0]])
    const receipt = await undoReceipt(client, target, missing)
    expectManualWarning(receipt, 'amount_changed', effect, effect.root_transaction_id, fixed.op_id, 0)
    expect(await effectRow(client, classId, effect.effect_id)).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
    await expectSubmissionState(client, target, 2, 0, 'pending', 0)
    await assertZeroReversal(client, classId, receipt, effect.root_transaction_id)
  })

  test('03:413 預檢會擋住已有有效效果的補回，保留原缺交效果', async () => {
    const { client } = db()
    const { target, missing, effectId } = await setupEffectConflict(client)
    const rejected = await rejectUndoWithoutChanges(client, undo(target.classId, missing.op_id), 'UNDO_CONFLICT')
    expect(rejected.current).toMatchObject({ reason: 'effect_already_active', effect_id: effectId })
    await expectSubmissionState(client, target, 3, 3, 'missing', -25, [[lateEvent, -6], [missingEvent, -20]])
    expect(await effectRow(client, target.classId, missing.result.effects_added[0].effect_id))
      .toMatchObject({ status: 'active', reversed_op_id: null })
  })

  test('補回已對應的歷史扣分沿用舊接替鏈與根交易歸屬', async () => {
    const { client } = db()
    const target = await assignTask(client, await addClass(client))
    const { classId, taskId, studentId } = target
    const rootId = await addLegacyTransaction(client, target, { amount: -10 })
    const lineageId = randomUUID()
    await client.query(`
      UPDATE ppt.submissions SET status = 'missing' WHERE class_id = $1 AND task_id = $2 AND student_id = $3
    `, [classId, taskId, studentId])
    await client.query(`
      INSERT INTO ppt.effects (class_id, student_id, effect_id, lineage_id, event, subject_kind,
        subject_key, root_transaction_id, status, origin)
      VALUES ($1, $2, $3, $3, $4, 'task', $5, $6, 'active', 'legacy')
    `, [classId, studentId, lineageId, missingEvent, taskId, rootId])
    await expectSubmissionState(client, target, 1, 1, 'missing', -10, [[missingEvent, -10]])
    const marked = await markSubmission(client, target, 'on_time')
    expect(marked.result.effects_reversed).toMatchObject([{
      effective_amount: -10, rule_id: null, rule_rev: null, root_transaction_id: rootId,
    }])
    await expectSubmissionState(client, target, 2, 2, 'on_time', 0)
    const receipt = await undoReceipt(client, target, marked)
    const [restored] = receipt.result.effects_added
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'rule_auto', amount: '-10', earned_delta: '-10', rule_id: null, rule_rev: null,
      restored_from_transaction_id: rootId, effective_at: new Date(marked.result.effects_reversed[0].effective_at),
      semester: '114-1', reason: '匯入交易',
    })
    expect(await effectRow(client, classId, restored.effect_id)).toMatchObject({ origin: 'op', lineage_id: lineageId })
    await expectSubmissionState(client, target, 3, 1, 'missing', -10, [[missingEvent, -10]])
  })
})
