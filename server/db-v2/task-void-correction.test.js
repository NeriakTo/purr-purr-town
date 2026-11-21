import { expect, test } from 'vitest'
import {
  changeRound, confirmedEvent, correctionRow, createRound, overdueEvent, returnRound, setEnrollment, taipeiDayOffset,
} from './test-support/correction-rounds.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, restoreTask, voidTask } from './test-support/schoolwork.js'
import { authorizeScheduler, offsetDay, overdueEffects, scheduleOverdue } from './test-support/scheduler.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'

const firstId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const missingEvent = 'submission.missing'
const missingAmount = -5
const rewardAmount = 7
const overdueAmount = -6

function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function confirmRound(client, round, rev) {
  return commitOperation(client, changeRound(round, 'confirm', { rev }))
}

function cancelRound(round, rev, reverseEffects) {
  return changeRound(round, 'cancel', { rev }, { reverse_effects: reverseEffects })
}

async function accountPoints(client, { classId, studentId }) {
  const { rows: [row] } = await client.query(
    'SELECT balance::int, total_earned::int FROM ppt.accounts WHERE class_id = $1 AND student_id = $2',
    [classId, studentId],
  )
  return row
}

async function pointsForStudents(client, { classId, studentIds }) {
  return Promise.all(studentIds.map(studentId => accountPoints(client, { classId, studentId })))
}

async function correctionTask(client) {
  const classroom = await addClass(client, { students: ['enrolled', 'enrolled'] })
  const startingPoints = await pointsForStudents(client, classroom)
  const task = await assignTask(client, classroom)
  const { classId } = task
  await saveEventRule(client, classId, missingEvent, missingAmount)
  await saveEventRule(client, classId, confirmedEvent, rewardAmount)
  await saveEventRule(client, classId, overdueEvent, overdueAmount)
  await authorizeScheduler(client, classId)
  const today = await taipeiDayOffset(client, 0)
  return {
    task, startingPoints, dueOn: offsetDay(today, -10), firstRun: offsetDay(today, -8),
  }
}

async function taskWithEffects(client) {
  const fixture = await correctionTask(client)
  const { task, dueOn, firstRun } = fixture
  const missing = await markSubmission(client, task, 'missing')
  const first = await createRound(client, task, { correction_id: firstId, due_on: dueOn })
  const other = await createRound(client, { ...task, studentId: task.studentIds[1] }, { due_on: dueOn })
  await scheduleOverdue(client, task.classId, firstRun)
  const confirmed = await confirmRound(client, first, 2)
  const second = await createRound(client, task, { correction_id: secondId, due_on: dueOn })
  const secondRun = offsetDay(firstRun, 1)
  await scheduleOverdue(client, task.classId, secondRun)
  await commitOperation(client, cancelRound(other, 2, false))
  return { ...fixture, missing, first, second, other, confirmed, secondRun }
}

async function classEffects(client, { classId }) {
  const { rows } = await client.query(`
    SELECT effect_id, student_id, event, subject_kind, subject_key, status, reversed_op_id
    FROM ppt.effects WHERE class_id = $1 ORDER BY effect_id COLLATE "C"
  `, [classId])
  return rows
}

async function assignmentRows(client, { classId, taskId }) {
  const { rows: [row] } = await client.query(`
    SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.correction_id) FROM ppt.corrections c
       WHERE c.class_id = $1 AND c.task_id = $2) AS corrections,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.student_id) FROM ppt.submissions s
       WHERE s.class_id = $1 AND s.task_id = $2) AS submissions
  `, [classId, taskId])
  return row
}

function expectAlreadyReversedWarning(receipt, original, opId) {
  const details = {
    effect_id: original.effect_id, lineage_id: original.lineage_id,
    transaction_id: original.root_transaction_id, changed_by_op_id: opId,
    original_amount: original.amount, amount: null,
  }
  expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'already_reversed', ...details }])
  expect(receipt.result.undo).toMatchObject({ skipped: [details], amount_changed: [] })
}

describeDatabase('OP-12 作廢選沖回含訂正效果', () => {
  const db = useTestDatabase()

  test('T1 作廢選退回：訂正的確認獎勵與逾期扣分都退，點數合計等於從沒做過', async () => {
    const { client } = db()
    const { task, first, second, other, startingPoints } = await taskWithEffects(client)
    const { classId, taskId, studentIds } = task
    const before = await assignmentRows(client, task)
    const active = await classEffects(client, task)
    expect(active.map(effect => effect.status)).toEqual(Array(5).fill('active'))
    const receipt = await commitOperation(client, voidTask(classId, taskId, true))
    expect(await classEffects(client, task)).toEqual(active.map(effect => ({
      ...effect, status: 'reversed', reversed_op_id: receipt.op_id,
    })))
    expect(await pointsForStudents(client, task)).toEqual(startingPoints)
    const reversed = receipt.result.effects_reversed
    expect(reversed).toHaveLength(5)
    expect(reversed).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: missingEvent, subject_kind: 'task', subject_key: taskId, effective_amount: missingAmount }),
      expect.objectContaining({
        event: confirmedEvent, subject_kind: 'correction', subject_key: first.correctionId, effective_amount: rewardAmount,
      }),
      ...[first, second, other].map(({ correctionId }) => expect.objectContaining({
        event: overdueEvent, subject_kind: 'correction', subject_key: correctionId, effective_amount: overdueAmount,
      })),
    ]))
    expect(receipt.result.transactions).toHaveLength(5)
    expect(receipt.changes.map(({ entity, key }) => ({ entity, key }))).toEqual([
      { entity: 'task', key: { task_id: taskId } },
      ...[...studentIds].sort(compareBytes).map(studentId => ({ entity: 'account', key: { student_id: studentId } })),
    ])
    expect(await assignmentRows(client, task)).toEqual(before)
    expect(receipt.result.unresolved_legacy_effects).toEqual([])
    expect(receipt.warnings).toEqual([])
  })

  test('T2 作廢不退回：訂正效果與點數都不動', async () => {
    const { client } = db()
    const { task } = await taskWithEffects(client)
    const { classId, taskId } = task
    const active = await classEffects(client, task)
    const points = await pointsForStudents(client, task)
    const receipt = await commitOperation(client, voidTask(classId, taskId, false))
    expect(receipt.result).toMatchObject({ transactions: [], effects_reversed: [] })
    expect(active.map(effect => effect.status)).toEqual(Array(5).fill('active'))
    expect(await classEffects(client, task)).toEqual(active)
    expect(await pointsForStudents(client, task)).toEqual(points)
    const repeat = await commitOperation(client, voidTask(classId, taskId, true, 2))
    expect(repeat.result).toMatchObject({ noop: true, transactions: [], effects_reversed: [] })
    expect(await classEffects(client, task)).toEqual(active)
    expect(await pointsForStudents(client, task)).toEqual(points)
  })

  test('T3 只退這份作業的訂正', async () => {
    const { client } = db()
    const { task, startingPoints: [startingPoints], dueOn, firstRun } = await correctionTask(client)
    const { classId, taskId } = task
    const otherTask = await assignTask(client, task)
    const first = await createRound(client, task, { correction_id: firstId, due_on: dueOn })
    const other = await createRound(client, otherTask, { due_on: dueOn })
    await scheduleOverdue(client, classId, firstRun)
    await commitOperation(client, changeRound(first, 'mark_returned', { rev: 2 }))
    await commitOperation(client, changeRound(first, 'redo', { rev: 3 }, {
      next_correction_id: secondId, next_due_on: null,
    }))
    await confirmRound(client, other, 2)
    const active = await classEffects(client, task)
    expect(active.map(effect => effect.status)).toEqual(Array(3).fill('active'))
    const receipt = await commitOperation(client, voidTask(classId, taskId, true))
    expect(await classEffects(client, task)).toEqual(active.map(effect => (
      effect.subject_key === first.correctionId
        ? { ...effect, status: 'reversed', reversed_op_id: receipt.op_id }
        : effect
    )))
    expect(receipt.result.effects_reversed.map(effect => effect.subject_key)).toEqual([first.correctionId])
    expect(await accountPoints(client, task)).toEqual({
      balance: startingPoints.balance + overdueAmount + rewardAmount,
      total_earned: startingPoints.total_earned + overdueAmount + rewardAmount,
    })
  })

  test('T4 同一位學生兩輪同事件：帳戶合併成一項，順序確定', async () => {
    const { client } = db()
    const { task, dueOn, firstRun } = await correctionTask(client)
    const { classId, taskId, studentId } = task
    const first = await createRound(client, task, { correction_id: firstId, due_on: dueOn })
    await scheduleOverdue(client, classId, firstRun)
    await confirmRound(client, first, 2)
    const second = await createRound(client, task, { correction_id: secondId, due_on: dueOn })
    await scheduleOverdue(client, classId, offsetDay(firstRun, 1))
    await confirmRound(client, second, 2)
    const receipt = await commitOperation(client, voidTask(classId, taskId, true))
    const expected = [first, second].flatMap(({ correctionId }) => (
      [overdueEvent, confirmedEvent].map(event => ({ event, subject_kind: 'correction', subject_key: correctionId }))
    )).sort((left, right) => compareBytes(left.event, right.event) || compareBytes(left.subject_key, right.subject_key))
    expect(receipt.result.effects_reversed).toMatchObject(expected)
    expect(receipt.changes.filter(change => change.entity === 'account')).toMatchObject([{ key: { student_id: studentId } }])
  })

  test('T5 已轉出學生的訂正效果也退', async () => {
    const { client } = db()
    const { task, startingPoints, dueOn, firstRun } = await correctionTask(client)
    const { classId, taskId } = task
    const other = await createRound(client, { ...task, studentId: task.studentIds[1] }, { due_on: dueOn })
    await scheduleOverdue(client, classId, firstRun)
    await setEnrollment(client, other, 'transferred')
    const receipt = await commitOperation(client, voidTask(classId, taskId, true))
    expect(await overdueEffects(client, other)).toMatchObject([{ status: 'reversed', reversed_op_id: receipt.op_id }])
    expect(await accountPoints(client, other)).toEqual(startingPoints[1])
  })

  test('T6 恢復不補回、排程不再扣', async () => {
    const { client } = db()
    const { task, second, secondRun } = await taskWithEffects(client)
    const { classId, taskId } = task
    await commitOperation(client, voidTask(classId, taskId, true))
    const points = await pointsForStudents(client, task)
    const effects = await classEffects(client, task)
    const overdue = await overdueEffects(client, second)
    expect(overdue).toHaveLength(1)
    const restored = await commitOperation(client, restoreTask(classId, taskId))
    expect(restored.result.transactions).toEqual([])
    expect(restored.warnings).toEqual([])
    expect(await pointsForStudents(client, task)).toEqual(points)
    expect(await classEffects(client, task)).toEqual(effects)
    const scheduled = await scheduleOverdue(client, classId, offsetDay(secondRun, 1))
    expect(scheduled).toMatchObject({ result: { noop: true, transactions: [], effects_added: [] }, changes: [] })
    expect(await overdueEffects(client, second)).toEqual(overdue)
    expect(await pointsForStudents(client, task)).toEqual(points)
    expect(await classEffects(client, task)).toEqual(effects)
  })

  test('T7 撤銷 OP-20：作廢期間被擋，恢復後只提示、不再退', async () => {
    const { client } = db()
    const { task, startingPoints: [startingPoints] } = await correctionTask(client)
    const { classId, taskId } = task
    const round = await createRound(client, task)
    await returnRound(client, round)
    const before = await correctionRow(client, round)
    const confirmed = await confirmRound(client, round, 2)
    const [effect] = confirmed.result.effects_added
    const voided = await commitOperation(client, voidTask(classId, taskId, true))
    await rejectUndoWithoutChanges(client, undo(classId, confirmed.op_id), 'ENTITY_INACTIVE')
    await commitOperation(client, restoreTask(classId, taskId))
    const receipt = await commitOperation(client, undo(classId, confirmed.op_id))
    expect(receipt.result.transactions).toEqual([])
    expectAlreadyReversedWarning(receipt, effect, voided.op_id)
    expect(await correctionRow(client, round)).toMatchObject({
      status: before.status, basis_rev: before.basis_rev, rev: before.rev + 2,
    })
    expect(await accountPoints(client, task)).toEqual(startingPoints)
  })

  test('T8 作廢退過之後，單筆沖回與取消並沖回都不重複退', async () => {
    const { client } = db()
    const { task, confirmed, second } = await taskWithEffects(client)
    const { classId, taskId } = task
    await commitOperation(client, voidTask(classId, taskId, true))
    const [effect] = confirmed.result.effects_added
    const cancel = await commitOperation(client, cancelRound(second, 2, true))
    const single = await submit(client, reverse(classId, effect.root_transaction_id, rewardAmount))
    expect(single).toMatchObject({ status: 'rejected', code: 'TX_ALREADY_REVERSED' })
    expect(cancel.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })
    expect(cancel.changes.map(({ entity }) => entity)).toEqual(['correction'])
  })
})
