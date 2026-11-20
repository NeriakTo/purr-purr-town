import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { expectCorrectionState, overdueEvent } from './test-support/correction-rounds.js'
import { classSequence, operationCount, submit } from './test-support/operations.js'
import {
  offsetDay, overdueEffects, overdueFixture, overdueOperation, scheduledId, scheduleOverdue, scheduler,
} from './test-support/scheduler.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

const penalty = -7
const noChanges = { status: 'committed', result: { noop: true, transactions: [], effects_added: [] }, changes: [] }

async function penaltyFixture(client) {
  const fixture = await overdueFixture(client)
  await saveEventRule(client, fixture.classId, overdueEvent, penalty)
  return { ...fixture, date: offsetDay(fixture.today, -8) }
}

describeDatabase('訂正逾期排程驗收', () => {
  const db = useTestDatabase()

  test('同日同編號連送三次只扣一次，同日換編號成立但無變更', async () => {
    const { client } = db()
    const { classId, target, date } = await penaltyFixture(client)
    const count = await operationCount(client)
    const seq = await classSequence(client, classId)
    const first = await scheduleOverdue(client, classId, date)
    expect(first).toMatchObject({ class_seq: seq + 1, replayed: false, result: { noop: false } })
    expect(first.result.transactions).toHaveLength(1)
    for (let repeat = 0; repeat < 2; repeat += 1) {
      expect(await scheduleOverdue(client, classId, date)).toEqual({ ...first, replayed: true })
    }
    expect(await operationCount(client)).toBe(count + 1)
    const alternateNamespace = Buffer.from('14866541acb342d2b02b9abfb3d72199', 'hex')
    const alternateId = scheduledId(classId, date, alternateNamespace)
    expect(alternateId).not.toBe(first.op_id)
    const alternate = await submit(client, overdueOperation(classId, date, alternateId), scheduler)
    expect(alternate).toMatchObject({ ...noChanges, class_seq: seq + 2, replayed: false })
    expect(await operationCount(client)).toBe(count + 2)
    expect(await overdueEffects(client, target)).toHaveLength(1)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('兩連線競送同編號十次，每日各有一份原收據及一份重播', async () => {
    const { client, connect } = db()
    const { classId, target, today } = await penaltyFixture(client)
    await commitOperation(client, setSetting(classId, 'correctionOverdueGraceDays', 0))
    const [left, right] = await Promise.all([connect(), connect()])
    const count = await operationCount(client)
    const seq = await classSequence(client, classId)
    for (let day = 0; day < 10; day += 1) {
      const date = offsetDay(today, day - 9)
      const op = overdueOperation(classId, date)
      const receipts = await Promise.all([submit(left, op, scheduler), submit(right, op, scheduler)])
      const [original] = receipts.filter((receipt) => receipt.replayed === false)
      expect(original).toMatchObject({
        status: 'committed', code: 'OK', class_seq: seq + day + 1, result: { noop: day > 0 },
      })
      expect(receipts.filter((receipt) => receipt.replayed === true)).toEqual([{ ...original, replayed: true }])
    }
    expect(await operationCount(client)).toBe(count + 10)
    expect(await classSequence(client, classId)).toBe(seq + 10)
    expect(await overdueEffects(client, target)).toHaveLength(1)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })

  test('老師單獨沖回逾期扣分，隔天排程保留已沖回歷史且不再扣', async () => {
    const { client } = db()
    const { classId, target, date } = await penaltyFixture(client)
    const original = await scheduleOverdue(client, classId, date)
    const [rootId] = original.result.transactions
    const reversal = await commitOperation(client, reverse(classId, rootId, penalty))
    const before = await classSnapshot(client, classId, { ignoreClassSequence: true })
    expect(await scheduleOverdue(client, classId, offsetDay(date, 1))).toMatchObject(noChanges)
    expect(await classSnapshot(client, classId, { ignoreClassSequence: true })).toBe(before)
    expect(await overdueEffects(client, target)).toMatchObject([{
      status: 'reversed', root_transaction_id: rootId, reversed_op_id: reversal.op_id,
    }])
    await expectCorrectionState(client, target, 2, 2, 'required', 0)
  })

  test('已有扣分的 OP-52 不可撤銷，資料與班級序號維持原值', async () => {
    const { client } = db()
    const { classId, target, date } = await penaltyFixture(client)
    const original = await scheduleOverdue(client, classId, date)
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    expect(original.result.transactions).toHaveLength(1)
    expect(await submit(client, undo(classId, original.op_id))).toMatchObject({ status: 'rejected', code: 'NOT_UNDOABLE' })
    expect(await classSnapshot(client, classId)).toBe(before)
    expect(await operationCount(client)).toBe(count + 1)
    await expectCorrectionState(client, target, 2, 2, 'required', penalty, [[overdueEvent, penalty]])
  })
})
