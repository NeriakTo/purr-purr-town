import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  addOverdueEffect, authorizeCorrectionAgent, changeRound, confirmedEvent, correctionRow, createRound,
  overdueEvent, returnRound, setEnrollment, setupCorrectionTask, submitAgentCorrection, taipeiDayOffset,
} from './test-support/correction-rounds.js'
import { commitOperation, retireRule, saveRule, voidTask } from './test-support/schoolwork.js'
import { assignTask, balanceOf, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { effectRow } from './test-support/undo-submissions.js'

const finish = (client, target, action, rev, fields) =>
  commitOperation(client, changeRound(target, action, { rev }, fields))

async function firstRound(client) {
  return createRound(client, await setupCorrectionTask(client))
}

async function setFinalStatus(client, target, status) {
  switch (status) {
    case 'confirmed': return finish(client, target, 'confirm', 1)
    case 'cancelled': return finish(client, target, 'cancel', 1, { reverse_effects: false })
    case 'redo':
      await returnRound(client, target)
      return finish(client, target, 'redo', 2, { next_correction_id: randomUUID() })
    default: throw new Error('未知測試狀態')
  }
}

function expectNoLedgerWrites(receipt) {
  expect(receipt.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })
  expect(receipt.changes.map(({ entity }) => entity)).toEqual(['correction'])
}

describeDatabase('訂正確認、退回、取消與改期限', () => {
  const database = useTestDatabase()

  test('OP-20 從已交回確認，用現行規則發放獎勵並保存效果與收據', async () => {
    const { client } = database()
    const target = await firstRound(client)
    const { rule_id: ruleId } = await saveEventRule(client, target.classId, confirmedEvent, 7)
    await returnRound(client, target)
    const receipt = await finish(client, target, 'confirm', 2)
    expect(await correctionRow(client, target)).toMatchObject({ rev: 3, basis_rev: 3, status: 'confirmed' })
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['correction', 'account'])
    expect(receipt.changes[0]).toMatchObject({ prev_value: { status: 'returned' }, value: { status: 'confirmed' } })
    expect(receipt.result.transactions).toHaveLength(1)
    const root = await transactionFrom(client, receipt)
    expect(root).toMatchObject({ kind: 'rule_auto', amount: '7', earned_delta: '7', rule_id: ruleId, rule_rev: 1 })
    expect(receipt.result.effects_added).toHaveLength(1)
    const effect = receipt.result.effects_added[0]
    expect(effect).toMatchObject({
      lineage_id: effect.effect_id, subject_kind: 'correction', subject_key: target.correctionId,
      event: confirmedEvent, amount: 7, root_transaction_id: root.transaction_id,
    })
    expect(await effectRow(client, target.classId, effect.effect_id)).toMatchObject({
      status: 'active', event: confirmedEvent, subject_kind: 'correction', subject_key: target.correctionId,
      lineage_id: effect.effect_id, rule_id: ruleId, rule_rev: 1,
    })
    expect(await balanceOf(client, target)).toBe(7)
  })

  test.each(['無規則', '零元規則', '停用規則'])('OP-20 直接確認且%s時只改訂正狀態', async (mode) => {
    const { client } = database()
    const target = await firstRound(client)
    if (mode !== '無規則') {
      const rule = await saveEventRule(client, target.classId, confirmedEvent, mode === '零元規則' ? 0 : 7)
      if (mode === '停用規則') await commitOperation(client, retireRule(target.classId, rule.rule_id, 1))
    }
    expectNoLedgerWrites(await finish(client, target, 'confirm', 1))
    expect(await correctionRow(client, target)).toMatchObject({ status: 'confirmed', rev: 2, basis_rev: 2 })
    expect(await balanceOf(client, target)).toBe(0)
  })

  test('OP-20 規則改版後的下一輪採新版本金額', async () => {
    const { client } = database()
    const target = await firstRound(client)
    const rule = await saveEventRule(client, target.classId, confirmedEvent, 7)
    const first = await finish(client, target, 'confirm', 1)
    await commitOperation(client, saveRule(target.classId, { ...rule, amount: 11 }, 1))
    const next = await createRound(client, target)
    const second = await finish(client, next, 'confirm', 1)
    expect(await transactionFrom(client, first)).toMatchObject({ rule_rev: 1, amount: '7' })
    expect(await transactionFrom(client, second)).toMatchObject({ rule_id: rule.rule_id, rule_rev: 2, amount: '11' })
    expect(await balanceOf(client, target)).toBe(18)
  })

  test.each(['confirmed', 'cancelled', 'redo'])('OP-20 拒絕已結束的 %s', async (status) => {
    const { client } = database()
    const target = await firstRound(client)
    await setFinalStatus(client, target, status)
    const { rev } = await correctionRow(client, target)
    await rejectUndoWithoutChanges(client, changeRound(target, 'confirm', { rev }), 'INVALID_TRANSITION')
  })

  test('OP-20 確認前先比對版本', async () => {
    const { client } = database()
    const target = await firstRound(client)
    await rejectUndoWithoutChanges(client, changeRound(target, 'confirm', { rev: 2 }), 'STALE_STATE')
  })

  test.each([
    ['作業作廢', (client, target) => commitOperation(client, voidTask(target.classId, target.taskId, false))],
    ['學生轉出', (client, target) => setEnrollment(client, target, 'transferred')],
  ])('%s時拒絕確認與退回，但仍可交回、改期限與取消', async (_name, deactivate) => {
    const { client } = database()
    const target = await firstRound(client)
    await deactivate(client, target)
    await rejectUndoWithoutChanges(client, changeRound(target, 'confirm', { rev: 1 }), 'ENTITY_INACTIVE')
    await returnRound(client, target)
    const redo = changeRound(target, 'redo', { rev: 2 }, { next_correction_id: randomUUID() })
    await rejectUndoWithoutChanges(client, redo, 'ENTITY_INACTIVE')
    await finish(client, target, 'set_due', 2, { due_on: await taipeiDayOffset(client, -2) })
    expectNoLedgerWrites(await finish(client, target, 'cancel', 3, { reverse_effects: false }))
    expect(await correctionRow(client, target)).toMatchObject({ status: 'cancelled', rev: 4, basis_rev: 4 })
  })

  test('OP-21 先關舊輪再開下一輪，收據兩項且新輪可用 after_op', async () => {
    const { client } = database()
    const dueOn = await taipeiDayOffset(client, -1)
    const target = await firstRound(client)
    await returnRound(client, target)
    const next = { ...target, correctionId: randomUUID() }
    const receipt = await finish(client, target, 'redo', 2, { next_correction_id: next.correctionId, next_due_on: dueOn })
    expect(await correctionRow(client, target)).toMatchObject({ rev: 3, basis_rev: 3, status: 'redo', round: 1 })
    expect(await correctionRow(client, next)).toMatchObject({
      rev: 1, basis_rev: 1, status: 'required', round: 2, due_on: dueOn, note: null,
    })
    expect(receipt.changes).toEqual([
      {
        entity: 'correction', key: { correction_id: target.correctionId }, rev: 3, basis_rev: 3, prev_rev: 2,
        prev_basis_rev: 2, last_op_id: receipt.op_id, prev_value: { status: 'returned' }, value: { status: 'redo' },
      },
      {
        entity: 'correction', key: { correction_id: next.correctionId }, rev: 1, basis_rev: 1, prev_rev: 0,
        prev_basis_rev: 0, last_op_id: receipt.op_id, prev_value: null,
        value: {
          task_id: target.taskId, student_id: target.studentId, round: 2,
          status: 'required', due_on: dueOn, note: null, overdue_on: null,
        },
      },
    ])
    await commitOperation(client, changeRound(next, 'mark_returned', { after_op: receipt.op_id }))
    expect(await correctionRow(client, next)).toMatchObject({ status: 'returned', rev: 2, basis_rev: 2 })
  })

  test('OP-21 依序檢查輸入、狀態、版本與下一輪編號', async () => {
    const { client } = database()
    const target = await firstRound(client)
    const used = await createRound(client, await assignTask(client, target))
    const redo = (rev, id) => changeRound(target, 'redo', { rev }, { next_correction_id: id })
    await rejectUndoWithoutChanges(client, redo(1, 'a'.repeat(64)), 'INVALID_PAYLOAD')
    await rejectUndoWithoutChanges(client, redo(1, randomUUID()), 'INVALID_TRANSITION')
    await returnRound(client, target)
    await rejectUndoWithoutChanges(client, redo(2, used.correctionId), 'ID_CONFLICT')
    await rejectUndoWithoutChanges(client, redo(2, target.correctionId), 'ID_CONFLICT')
    await rejectUndoWithoutChanges(client, redo(1, used.correctionId), 'STALE_STATE')
  })

  test.each([['required', true], ['returned', false]])(
    'OP-22 取消 %s（沖回 %s）且沒有有效效果時不寫存摺，下一輪不重用編號',
    async (status, reverseEffects) => {
      const { client } = database()
      const target = await firstRound(client)
      if (status === 'returned') await returnRound(client, target)
      const { rev } = await correctionRow(client, target)
      expectNoLedgerWrites(await finish(client, target, 'cancel', rev, { reverse_effects: reverseEffects }))
      expect(await correctionRow(client, target)).toMatchObject({ status: 'cancelled', rev: rev + 1, basis_rev: rev + 1 })
      expect(await correctionRow(client, await createRound(client, target))).toMatchObject({ round: 2 })
    },
  )

  test.each([true, false])('OP-22 有逾期效果時依沖回旗標 %s 處理', async (reverseEffects) => {
    const { client } = database()
    const target = await firstRound(client)
    const rule = await saveEventRule(client, target.classId, overdueEvent, -6)
    const effect = await addOverdueEffect(client, target, rule)
    const before = await balanceOf(client, target)
    const receipt = await finish(client, target, 'cancel', 1, { reverse_effects: reverseEffects })
    expect(await correctionRow(client, target)).toMatchObject({ status: 'cancelled' })
    if (reverseEffects) {
      expect(await transactionFrom(client, receipt)).toMatchObject({
        kind: 'reversal', amount: '6', root_transaction_id: effect.rootId,
      })
      expect(receipt.result.effects_reversed).toMatchObject([{
        effect_id: effect.effectId, rule_id: rule.rule_id, rule_rev: 1,
        effective_amount: -6, effective_at: effect.effectiveAt,
      }])
    } else {
      expectNoLedgerWrites(receipt)
    }
    expect(await effectRow(client, target.classId, effect.effectId)).toMatchObject({
      status: reverseEffects ? 'reversed' : 'active',
    })
    expect(await balanceOf(client, target)).toBe(before + (reverseEffects ? 6 : 0))
  })

  test('OP-22 對改成零元的逾期效果仍寫沖回，之後不能再更正或沖回', async () => {
    const { client } = database()
    const target = await firstRound(client)
    const rule = await saveEventRule(client, target.classId, overdueEvent, -6)
    const { rootId, effectId } = await addOverdueEffect(client, target, rule)
    await commitOperation(client, correct(target.classId, rootId, -6, 0))
    const receipt = await finish(client, target, 'cancel', 1, { reverse_effects: true })
    expect(await transactionFrom(client, receipt)).toMatchObject({ kind: 'reversal', amount: '0' })
    expect(await effectRow(client, target.classId, effectId)).toMatchObject({ status: 'reversed' })
    await rejectUndoWithoutChanges(client, correct(target.classId, rootId, 0, 2), 'TX_ALREADY_REVERSED')
    await rejectUndoWithoutChanges(client, reverse(target.classId, rootId, 0), 'TX_ALREADY_REVERSED')
  })

  test('OP-22 拒絕缺少旗標、非布林與已結束的輪次', async () => {
    const { client } = database()
    const target = await firstRound(client)
    await rejectUndoWithoutChanges(client, changeRound(target, 'cancel', { rev: 1 }), 'INVALID_PAYLOAD')
    const bad = changeRound(target, 'cancel', { rev: 1 }, { reverse_effects: 'true' })
    await rejectUndoWithoutChanges(client, bad, 'INVALID_PAYLOAD')
    await finish(client, target, 'confirm', 1)
    const closed = changeRound(target, 'cancel', { rev: 2 }, { reverse_effects: true })
    await rejectUndoWithoutChanges(client, closed, 'INVALID_TRANSITION')
  })

  test('OP-23 只改期限與基準，接受清空與同值成立', async () => {
    const { client } = database()
    const target = await firstRound(client)
    const dueOn = await taipeiDayOffset(client, -10)
    const changed = await finish(client, target, 'set_due', 1, { due_on: dueOn })
    expect(changed.changes).toMatchObject([{
      rev: 2, basis_rev: 2, prev_rev: 1, prev_basis_rev: 1,
      prev_value: { due_on: null }, value: { due_on: dueOn },
    }])
    expect(await correctionRow(client, target)).toMatchObject({ rev: 2, basis_rev: 2, due_on: dueOn })
    const snapshot = await classSnapshot(client, target.classId, { ignoreClassSequence: true })
    const same = await finish(client, target, 'set_due', 2, { due_on: dueOn })
    expect(same.result.noop).toBe(true)
    expect(same.class_seq).toBe(changed.class_seq + 1)
    expect(same.changes).toMatchObject([{
      entity: 'correction', rev: 2, basis_rev: 2, prev_rev: 2, prev_basis_rev: 2,
      prev_value: { due_on: dueOn }, value: { due_on: dueOn },
    }])
    expect(await classSnapshot(client, target.classId, { ignoreClassSequence: true })).toBe(snapshot)
    const cleared = await finish(client, target, 'set_due', 2, { due_on: null })
    expect(cleared.changes).toMatchObject([{
      rev: 3, basis_rev: 3, prev_value: { due_on: dueOn }, value: { due_on: null },
    }])
    expect(await correctionRow(client, target)).toMatchObject({ rev: 3, basis_rev: 3, due_on: null })
  })

  test('OP-23 拒絕未提供期限與已結束的輪次', async () => {
    const { client } = database()
    const target = await firstRound(client)
    await rejectUndoWithoutChanges(client, changeRound(target, 'set_due', { rev: 1 }), 'INVALID_PAYLOAD')
    await finish(client, target, 'confirm', 1)
    const op = changeRound(target, 'set_due', { rev: 2 }, { due_on: null })
    await rejectUndoWithoutChanges(client, op, 'INVALID_TRANSITION')
  })

  test.each(['confirm', 'redo', 'cancel', 'set_due'])('小野呼叫 %s 回 FORBIDDEN_ROLE', async (action) => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    await authorizeCorrectionAgent(client, target)
    const op = changeRound({ ...target, correctionId: randomUUID() }, action, { rev: 1 })
    expect(await submitAgentCorrection(client, op)).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_ROLE' })
  })
})
