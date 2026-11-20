import { expect, test } from 'vitest'
import {
  changeRound, correctionRow, createRound, expectCorrectionState, overdueEvent, setEnrollment,
} from './test-support/correction-rounds.js'
import { submit } from './test-support/operations.js'
import { offsetDay, overdueEffects, overdueFixture, scheduleOverdue } from './test-support/scheduler.js'
import { commitOperation, restoreTask, saveRule, voidTask } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { assignTask, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { transactionFrom } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

const penalty = -6
const graceKey = 'correctionOverdueGraceDays'
const noChanges = { result: { noop: true, transactions: [], effects_added: [] }, changes: [] }

async function assertTransactionTimes(client, receipt, date) {
  const { rows } = await client.query(`
    SELECT t.occurred_at = o.committed_at AND t.effective_at = o.committed_at AS same_time,
           (t.effective_at AT TIME ZONE 'Asia/Taipei')::date <> $2::date AS differs_from_schedule
    FROM ppt.transactions t JOIN ppt.operations o USING (class_id, op_id)
    WHERE t.op_id = $1
  `, [receipt.op_id, date])
  expect(rows).toEqual([{ same_time: true, differs_from_schedule: true }])
}

describeDatabase('OP-52 訂正逾期扣分', () => {
  const db = useTestDatabase()

  test('預設寬限一天取嚴格邊界，逾期日期與交易時間各依來源', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    const rule = await saveEventRule(client, classId, overdueEvent, penalty)
    expect(await scheduleOverdue(client, classId, offsetDay(today, -9))).toMatchObject(noChanges)
    await expectCorrectionState(client, target, 1, 1, 'required', 0)
    expect((await correctionRow(client, target)).overdue_on).toBeNull()
    const date = offsetDay(today, -8)
    const receipt = await scheduleOverdue(client, classId, date)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
    expect(await correctionRow(client, target)).toMatchObject({ overdue_on: date, last_op_id: receipt.op_id })
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'rule_auto', amount: String(penalty), earned_delta: String(penalty), rule_id: rule.rule_id, rule_rev: 1,
    })
    await assertTransactionTimes(client, receipt, date)
    const effect = {
      event: overdueEvent, subject_kind: 'correction', subject_key: target.correctionId,
      root_transaction_id: receipt.result.transactions[0],
    }
    expect(await overdueEffects(client, target)).toMatchObject([{ ...effect, status: 'active' }])
    expect(receipt.result).toMatchObject({ noop: false, effects_added: [{ ...effect, amount: penalty }] })
    expect(receipt.changes).toMatchObject([{
      entity: 'correction', key: { correction_id: target.correctionId }, last_op_id: receipt.op_id,
      prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 2,
    }, { entity: 'account', key: { student_id: target.studentId }, value: { balance: penalty } }])
    expect(receipt.changes[0].prev_value).toEqual({ overdue_on: null })
    expect(receipt.changes[0].value).toEqual({ overdue_on: date })
  })

  test.each([
    [0, null, -9], [3, -7, -6],
  ])('讀取設定的 %i 天寬限', async (grace, boundary, overdue) => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    await commitOperation(client, setSetting(classId, graceKey, grace))
    await saveEventRule(client, classId, overdueEvent, penalty)
    if (boundary !== null) {
      expect(await scheduleOverdue(client, classId, offsetDay(today, boundary))).toMatchObject(noChanges)
    }
    const date = offsetDay(today, overdue)
    await scheduleOverdue(client, classId, date)
    expect(await correctionRow(client, target)).toMatchObject({ overdue_on: date, rev: 2, basis_rev: 2 })
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('OP-43 接受帶小數位的整數設定，排程依相同天數判定', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    const setting = JSON.stringify(setSetting(classId, graceKey, 3)).replace('"value":3', '"value":3.0')
    expect(await submit(client, setting)).toMatchObject({ status: 'committed', code: 'OK' })
    expect(await scheduleOverdue(client, classId, offsetDay(today, -7))).toMatchObject(noChanges)
    const overdue = offsetDay(today, -6)
    await scheduleOverdue(client, classId, overdue)
    expect(await correctionRow(client, target)).toMatchObject({ overdue_on: overdue })
  })

  test.each(['returned', '無期限', 'confirmed', 'cancelled'])('跳過 %s 的訂正', async (scenario) => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    await saveEventRule(client, classId, overdueEvent, penalty)
    const change = {
      returned: ['mark_returned', {}],
      無期限: ['set_due', { due_on: null }],
      confirmed: ['confirm', {}],
      cancelled: ['cancel', { reverse_effects: false }],
    }[scenario]
    await commitOperation(client, changeRound(target, change[0], { rev: 1 }, change[1]))
    const before = await correctionRow(client, target)
    expect(await scheduleOverdue(client, classId, offsetDay(today, -8))).toMatchObject(noChanges)
    expect(await correctionRow(client, target)).toEqual(before)
    expect(await overdueEffects(client, target)).toEqual([])
  })

  test.each(['無規則', '零元規則'])('%s 先記日期，啟用扣分金額後只補交易', async (scenario) => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    const hasRule = scenario === '零元規則'
    const prior = hasRule ? await saveEventRule(client, classId, overdueEvent, 0) : undefined
    const date = offsetDay(today, -8)
    const first = await scheduleOverdue(client, classId, date)
    expect(first).toMatchObject({
      result: { noop: false, transactions: [], effects_added: [] }, changes: [{ entity: 'correction' }],
    })
    const marked = await correctionRow(client, target)
    expect(marked).toMatchObject({ overdue_on: date, rev: 2, basis_rev: 2 })
    expect(await overdueEffects(client, target)).toEqual([])
    await commitOperation(client, saveRule(classId, {
      ...prior, kind: 'event', event: overdueEvent, amount: penalty,
    }, hasRule ? 1 : 0))
    const later = await scheduleOverdue(client, classId, offsetDay(date, 1))
    expect(later).toMatchObject({
      result: { noop: false, effects_added: [{ amount: penalty }] },
      changes: [{ entity: 'account', key: { student_id: target.studentId } }],
    })
    expect(later.result.transactions).toHaveLength(1)
    expect(await correctionRow(client, target)).toEqual(marked)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('多輪照學生及訂正編號寫入，帳戶合併最早前值及最後現值', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(
      client, { students: ['enrolled', 'enrolled'] }, { correction_id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' },
    )
    const [firstStudent, secondStudent] = target.studentIds
    const fields = { due_on: offsetDay(today, -10) }
    const secondStudentRound = await createRound(client, { ...target, studentId: secondStudent }, fields)
    const secondTaskRound = await createRound(client, await assignTask(client, target), {
      ...fields, correction_id: '00000000-0000-4000-8000-000000000000',
    })
    await saveEventRule(client, classId, overdueEvent, penalty)
    const receipt = await scheduleOverdue(client, classId, offsetDay(today, -8))
    const ordered = [target, secondStudentRound, secondTaskRound].sort((a, b) => {
      const left = a.studentId + a.correctionId
      const right = b.studentId + b.correctionId
      return left < right ? -1 : Number(left > right)
    })
    const ids = ordered.map(({ correctionId }) => correctionId)
    const accounts = [firstStudent, secondStudent].sort().map((studentId) => {
      const count = studentId === firstStudent ? 2 : 1
      return {
        entity: 'account', key: { student_id: studentId }, prev_rev: 1, rev: 1 + count,
        prev_value: { balance: 0, total_earned: 0 },
        value: { balance: count * penalty, total_earned: count * penalty },
      }
    })
    expect(receipt.changes).toMatchObject([
      ...ids.map((id) => ({ entity: 'correction', key: { correction_id: id } })), ...accounts,
    ])
    expect(receipt.result.effects_added.map(({ subject_key: key }) => key)).toEqual(ids)
    expect(receipt.result.transactions).toEqual(receipt.result.effects_added.map((effect) => effect.root_transaction_id))
    for (const round of ordered) {
      expect(await overdueEffects(client, round)).toMatchObject([{ status: 'active' }])
    }
  })

  test('作廢與轉出期間整輪跳過，恢復與回到在學後照常扣分', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client, { students: ['enrolled', 'enrolled'] })
    const transferTask = await assignTask(client, { ...target, studentId: target.studentIds[1] })
    const transferred = await createRound(client, transferTask, { due_on: offsetDay(today, -10) })
    await saveEventRule(client, classId, overdueEvent, penalty)
    await commitOperation(client, voidTask(classId, target.taskId, false))
    await setEnrollment(client, transferred, 'transferred')
    expect(await scheduleOverdue(client, classId, offsetDay(today, -8))).toMatchObject(noChanges)
    for (const round of [target, transferred]) {
      expect((await correctionRow(client, round)).overdue_on).toBeNull()
      await expectCorrectionState(client, round, 1, 1, 'required', 0)
    }
    await commitOperation(client, restoreTask(classId, target.taskId))
    const restoredDay = offsetDay(today, -7)
    await scheduleOverdue(client, classId, restoredDay)
    expect((await correctionRow(client, target)).overdue_on).toBe(restoredDay)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
    await expectCorrectionState(client, transferred, 1, 1, 'required', 0)
    await setEnrollment(client, transferred, 'enrolled')
    const enrolledDay = offsetDay(today, -6)
    await scheduleOverdue(client, classId, enrolledDay)
    expect((await correctionRow(client, transferred)).overdue_on).toBe(enrolledDay)
    await expectCorrectionState(client, transferred, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('逾期扣過後改早期限，原逾期日與扣分都保留', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    await saveEventRule(client, classId, overdueEvent, penalty)
    const date = offsetDay(today, -8)
    await scheduleOverdue(client, classId, date)
    await commitOperation(client, changeRound(target, 'set_due', { rev: 2 }, { due_on: offsetDay(today, -11) }))
    expect(await scheduleOverdue(client, classId, offsetDay(date, 1))).toMatchObject(noChanges)
    expect((await correctionRow(client, target)).overdue_on).toBe(date)
    expect(await overdueEffects(client, target)).toHaveLength(1)
    await expectCorrectionState(client, target, 3, 3, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('取消沖回真實扣分，撤銷依原快照補回，隔天無額外扣分', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    const rule = await saveEventRule(client, classId, overdueEvent, penalty)
    const date = offsetDay(today, -8)
    const original = await scheduleOverdue(client, classId, date)
    const [added] = original.result.effects_added
    const cancel = await commitOperation(client, changeRound(target, 'cancel', { rev: 2 }, { reverse_effects: true }))
    expect(await transactionFrom(client, cancel)).toMatchObject({ kind: 'reversal', amount: String(-penalty) })
    expect(cancel.result.effects_reversed).toMatchObject([{ effective_amount: penalty, rule_id: rule.rule_id }])
    await expectCorrectionState(client, target, 3, 3, 'cancelled', 0)
    await commitOperation(client, saveRule(classId, { ...rule, amount: -9 }, 1))
    const restored = await commitOperation(client, undo(classId, cancel.op_id))
    expect(await transactionFrom(client, restored)).toMatchObject({
      kind: 'rule_auto', amount: String(penalty), rule_rev: 1, restored_from_transaction_id: added.root_transaction_id,
    })
    expect(await scheduleOverdue(client, classId, offsetDay(date, 1))).toMatchObject(noChanges)
    const effects = await overdueEffects(client, target)
    expect(effects).toHaveLength(2)
    expect(effects.filter((effect) => effect.status === 'active')).toMatchObject([{
      lineage_id: added.lineage_id, root_transaction_id: restored.result.transactions[0],
    }])
    await expectCorrectionState(client, target, 4, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('記逾期日更新基準，建立操作不可撤，但仍可取消並沖回', async () => {
    const { client } = db()
    const { target, today, classId } = await overdueFixture(client)
    await saveEventRule(client, classId, overdueEvent, penalty)
    const date = offsetDay(today, -8)
    const original = await scheduleOverdue(client, classId, date)
    expect(await submit(client, undo(classId, target.created.op_id))).toMatchObject({
      code: 'UNDO_CONFLICT', current: {
        reason: 'basis_changed', correction_id: target.correctionId, rev: 2, basis_rev: 2,
        last_op_id: original.op_id, value: { overdue_on: date },
      },
    })
    await commitOperation(client, changeRound(target, 'cancel', { rev: 2 }, { reverse_effects: true }))
    await expectCorrectionState(client, target, 3, 3, 'cancelled', 0)
  })
})
