import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  addOverdueEffect, authorizeCorrectionAgent, changeRound, confirmedEvent, correctionRow, createRound,
  expectCorrectionState, overdueEvent, requireRound, returnRound, setEnrollment, setupCorrectionTask,
  submitAgentCorrection, taipeiDayOffset,
} from './test-support/correction-rounds.js'
import { teacher } from './test-support/operations.js'
import { commitOperation, restoreTask, saveRule, voidTask } from './test-support/schoolwork.js'
import { saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { effectRow } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

async function startRound(client) {
  return createRound(client, await setupCorrectionTask(client), { note: '補列算式' })
}

async function undoReceipt(client, target, original) {
  return commitOperation(client, undo(target.classId, original.op_id))
}

async function confirmWithReward(client, returned = true) {
  const target = await startRound(client)
  await saveEventRule(client, target.classId, confirmedEvent, 7)
  if (returned) await returnRound(client, target)
  const original = await commitOperation(client, changeRound(target, 'confirm', { rev: returned ? 2 : 1 }))
  return { target, original, rootId: original.result.transactions[0], reward: original.result.effects_added[0] }
}

async function redoWithNext(client) {
  const target = await startRound(client)
  await returnRound(client, target)
  const next = { ...target, correctionId: randomUUID() }
  const original = await commitOperation(client, changeRound(
    target, 'redo', { rev: 2 }, { next_correction_id: next.correctionId },
  ))
  return { target, next, original }
}

async function cancelWithEffect(client, reverseEffects, effectiveAmount = -6) {
  const target = await startRound(client)
  const rule = await saveEventRule(client, target.classId, overdueEvent, -6)
  const effect = await addOverdueEffect(client, target, rule)
  if (effectiveAmount !== -6) await commitOperation(client, correct(target.classId, effect.rootId, -6, effectiveAmount))
  const original = await commitOperation(client, changeRound(
    target, 'cancel', { rev: 1 }, { reverse_effects: reverseEffects },
  ))
  return { target, rule, effect, original }
}

function expectedConflict(target, last, reason, status, rev, basis, extra = {}) {
  return {
    reason, correction_id: target.correctionId, rev, basis_rev: basis,
    value: { status, round: 1, due_on: null, overdue_on: null },
    last_op_id: last.op_id, actor: teacher, committed_at: last.committed_at, ...extra,
  }
}

describeDatabase('訂正撤銷', () => {
  const database = useTestDatabase()

  test('撤 OP-18 留取消列與基準零，重撤被拒，輪次不重用', async () => {
    const { client } = database()
    const target = await startRound(client)
    const receipt = await undoReceipt(client, target, target.created)
    await expectCorrectionState(client, target, 2, 0, 'cancelled', 0)
    expect(receipt.changes).toEqual([{
      entity: 'correction', key: { correction_id: target.correctionId }, last_op_id: receipt.op_id,
      prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 0,
      prev_value: { status: 'required' }, value: { status: 'cancelled' },
    }])
    expect(receipt.result.undo).toEqual({ target_op_id: target.created.op_id, skipped: [], amount_changed: [] })
    await rejectUndoWithoutChanges(client, undo(target.classId, target.created.op_id), 'ALREADY_UNDONE')
    const next = await createRound(client, target)
    await expectCorrectionState(client, next, 1, 1, 'required', 0)
    expect(await correctionRow(client, next)).toMatchObject({ round: 2 })
  })

  test('撤 OP-19 回復交回前的基準，after_op 可接續重做', async () => {
    const { client } = database()
    const target = await startRound(client)
    const original = await returnRound(client, target)
    const undone = await undoReceipt(client, target, original)
    await expectCorrectionState(client, target, 3, 1, 'required', 0)
    await commitOperation(client, changeRound(target, 'mark_returned', { after_op: undone.op_id }))
    await expectCorrectionState(client, target, 4, 4, 'returned', 0)
  })

  test.each([true, false])('撤 OP-20（原先已交回 %s）回復原狀態與餘額', async (returned) => {
    const { client } = database()
    const { target, original, rootId, reward } = await confirmWithReward(client, returned)
    await expectCorrectionState(client, target, returned ? 3 : 2, returned ? 3 : 2, 'confirmed', 7, [[confirmedEvent, 7]])
    const undone = await undoReceipt(client, target, original)
    await expectCorrectionState(client, target, returned ? 4 : 3, returned ? 2 : 1, returned ? 'returned' : 'required', 0)
    expect(await transactionFrom(client, undone)).toMatchObject({
      amount: '-7', kind: 'reversal', root_transaction_id: rootId,
    })
    expect(await effectRow(client, target.classId, reward.effect_id)).toMatchObject({
      status: 'reversed', reversed_op_id: undone.op_id,
    })
  })

  test.each([
    ['already_reversed', (classId, rootId) => reverse(classId, rootId, 7)],
    ['amount_changed', (classId, rootId) => correct(classId, rootId, 7, 3)],
  ])('撤 OP-20 帶 %s 提示並依現況沖回', async (warning, changeEffect) => {
    const { client } = database()
    const { target, original, rootId } = await confirmWithReward(client)
    const adjustment = await commitOperation(client, changeEffect(target.classId, rootId))
    const receipt = await undoReceipt(client, target, original)
    await expectCorrectionState(client, target, 4, 2, 'returned', 0)
    expect(receipt.warnings).toMatchObject([{
      code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: warning, transaction_id: rootId, changed_by_op_id: adjustment.op_id,
    }])
    if (warning === 'already_reversed') {
      expect(receipt.result.transactions).toEqual([])
      expect(receipt.result.undo.skipped).toHaveLength(1)
    } else {
      expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '-3' })
      expect(receipt.result.undo.amount_changed).toHaveLength(1)
    }
  })

  test('撤 OP-21 先取消新輪再回復舊輪，收據與寫入同序', async () => {
    const { client } = database()
    const { target, next, original } = await redoWithNext(client)
    const receipt = await undoReceipt(client, target, original)
    await expectCorrectionState(client, target, 4, 2, 'returned', 0)
    await expectCorrectionState(client, next, 2, 0, 'cancelled', 0)
    expect(receipt.changes).toMatchObject([
      { key: { correction_id: next.correctionId }, prev_basis_rev: 1, basis_rev: 0, value: { status: 'cancelled' } },
      { key: { correction_id: target.correctionId }, prev_basis_rev: 3, basis_rev: 2, value: { status: 'returned' } },
    ])
  })

  test('撤 OP-21 時下一輪基準改過，回下一輪現況且資料不變', async () => {
    const { client } = database()
    const { target, next, original } = await redoWithNext(client)
    const later = await returnRound(client, next)
    const receipt = await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'UNDO_CONFLICT')
    expect(receipt.current).toEqual(expectedConflict(next, later, 'basis_changed', 'returned', 2, 2, {
      value: { status: 'returned', round: 2, due_on: null, overdue_on: null },
    }))
    await expectCorrectionState(client, target, 3, 3, 'redo', 0)
    await expectCorrectionState(client, next, 2, 2, 'returned', 0)
  })

  test('撤 OP-22 依快照補回更正過的逾期效果，沿用根交易與接替鏈', async () => {
    const { client } = database()
    const { target, rule, effect, original } = await cancelWithEffect(client, true, -9)
    await expectCorrectionState(client, target, 2, 2, 'cancelled', 1)
    await commitOperation(client, saveRule(target.classId, { ...rule, amount: -12 }, 1))
    const receipt = await undoReceipt(client, target, original)
    await expectCorrectionState(client, target, 3, 1, 'required', -8, [[overdueEvent, -9]])
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'rule_auto', amount: '-9', rule_id: rule.rule_id, rule_rev: 1, restored_from_transaction_id: effect.rootId,
    })
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['correction', 'account'])
    expect(receipt.result.effects_added).toMatchObject([{ lineage_id: effect.effectId, amount: -9 }])
    const restored = receipt.result.effects_added[0]
    expect(await effectRow(client, target.classId, restored.effect_id)).toMatchObject({
      status: 'active', lineage_id: effect.effectId, rule_rev: 1, created_op_id: receipt.op_id,
    })
    expect(restored.effect_id).not.toBe(effect.effectId)
  })

  test.each([['保留效果', false, -6], ['零元快照', true, 0]])('撤 OP-22（%s）只回復訂正列', async (_label, flag, amount) => {
    const { client } = database()
    const { target, effect, original } = await cancelWithEffect(client, flag, amount)
    const receipt = await undoReceipt(client, target, original)
    expect(receipt.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['correction'])
    expect(await effectRow(client, target.classId, effect.effectId)).toMatchObject({ status: flag ? 'reversed' : 'active' })
    await expectCorrectionState(client, target, 3, 1, 'required', 1 + amount, flag ? [] : [[overdueEvent, amount]])
  })

  test('撤 OP-22 遇到有效效果衝突，回 effect_id 且資料不變', async () => {
    const { client } = database()
    const { target, rule, original } = await cancelWithEffect(client, true)
    const { effectId } = await addOverdueEffect(client, target, rule)
    const receipt = await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'UNDO_CONFLICT')
    expect(receipt.current).toEqual(expectedConflict(target, original, 'effect_already_active', 'cancelled', 2, 2, {
      effect_id: effectId,
    }))
    await expectCorrectionState(client, target, 2, 2, 'cancelled', -4, [[overdueEvent, -6]])
  })

  test('撤 OP-22 同時撞到未結束輪次和有效效果時，先回 open_round_exists', async () => {
    const { client } = database()
    const { target, rule, original } = await cancelWithEffect(client, true)
    await addOverdueEffect(client, target, rule)
    const next = await createRound(client, target)
    const receipt = await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'UNDO_CONFLICT')
    expect(receipt.current).toEqual(expectedConflict(next, next.created, 'open_round_exists', 'required', 1, 1, {
      value: { status: 'required', round: 2, due_on: null, overdue_on: null },
    }))
    await expectCorrectionState(client, target, 2, 2, 'cancelled', -4, [[overdueEvent, -6]])
    await expectCorrectionState(client, next, 1, 1, 'required', -4)
  })

  test('改期限推進基準，之後不能撤較早的 OP-19', async () => {
    const { client } = database()
    const target = await startRound(client)
    const original = await returnRound(client, target)
    const dueOn = await taipeiDayOffset(client, -5)
    const later = await commitOperation(client, changeRound(target, 'set_due', { rev: 2 }, { due_on: dueOn }))
    const receipt = await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'UNDO_CONFLICT')
    expect(receipt.current).toEqual(expectedConflict(target, later, 'basis_changed', 'returned', 3, 3, {
      value: { status: 'returned', round: 1, due_on: dueOn, overdue_on: null },
    }))
    await expectCorrectionState(client, target, 3, 3, 'returned', 0)
  })

  test('作業作廢時撤銷被拒，恢復後可用新編號撤銷', async () => {
    const { client } = database()
    const target = await startRound(client)
    const original = await returnRound(client, target)
    await commitOperation(client, voidTask(target.classId, target.taskId, false))
    const blocked = await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'ENTITY_INACTIVE')
    await expectCorrectionState(client, target, 2, 2, 'returned', 0)
    await commitOperation(client, restoreTask(target.classId, target.taskId))
    const receipt = await undoReceipt(client, target, original)
    expect(receipt.op_id).not.toBe(blocked.op_id)
    await expectCorrectionState(client, target, 3, 1, 'required', 0)
  })

  test('學生轉出時撤 OP-18 被拒且不改資料', async () => {
    const { client } = database()
    const target = await startRound(client)
    await setEnrollment(client, target, 'transferred')
    await rejectUndoWithoutChanges(client, undo(target.classId, target.created.op_id), 'ENTITY_INACTIVE')
    await expectCorrectionState(client, target, 1, 1, 'required', 0)
  })

  test('小野能撤自己的 OP-18，不能撤老師的 OP-18，老師能撤小野的 OP-19', async () => {
    const { client } = database()
    const teacherRound = await startRound(client)
    await authorizeCorrectionAgent(client, teacherRound)
    const reject = await submitAgentCorrection(client, undo(teacherRound.classId, teacherRound.created.op_id))
    expect(reject).toMatchObject({ code: 'SCOPE_FORBIDDEN' })
    expect(reject).not.toHaveProperty('current')
    const returned = await submitAgentCorrection(client, changeRound(teacherRound, 'mark_returned', { rev: 1 }))
    expect(returned.code).toBe('OK')
    await undoReceipt(client, teacherRound, returned)
    await expectCorrectionState(client, teacherRound, 3, 1, 'required', 0)
    await undoReceipt(client, teacherRound, teacherRound.created)
    await expectCorrectionState(client, teacherRound, 4, 0, 'cancelled', 0)
    const op = requireRound(teacherRound, { note: '補上列式' })
    expect((await submitAgentCorrection(client, op)).code).toBe('OK')
    const undone = await submitAgentCorrection(client, undo(teacherRound.classId, op.op_id))
    expect(undone).toMatchObject({ code: 'OK', changes: [{
      prev_value: { status: 'required' }, value: { status: 'cancelled' },
    }] })
    expect(undone.changes[0].prev_value).not.toHaveProperty('note')
    await expectCorrectionState(client, { ...teacherRound, correctionId: op.payload.correction_id }, 2, 0, 'cancelled', 0)
  })

  test('小野的撤銷預檢基準衝突只帶身分種類，四鍵現況省略備註', async () => {
    const { client } = database()
    const task = await setupCorrectionTask(client)
    await authorizeCorrectionAgent(client, task)
    const create = requireRound(task, { note: '補上列式' })
    expect((await submitAgentCorrection(client, create)).code).toBe('OK')
    const target = { ...task, correctionId: create.payload.correction_id }
    const returned = await returnRound(client, target)
    const receipt = await submitAgentCorrection(client, undo(task.classId, create.op_id))
    expect(receipt).toMatchObject({ code: 'UNDO_CONFLICT' })
    expect(receipt.current).toEqual(expectedConflict(target, returned, 'basis_changed', 'returned', 2, 2, {
      actor: { kind: 'teacher' },
    }))
    await expectCorrectionState(client, target, 2, 2, 'returned', 0)
  })
})
