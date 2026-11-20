import { expect, test } from 'vitest'
import { confirm, confirmationsFor, propose } from './test-support/confirmations.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, saveRule } from './test-support/schoolwork.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { transactionFrom } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'
import { effectRow, expectSubmissionState, lateEvent, missingEvent, setupSubmissionUndo } from './test-support/undo-submissions.js'

const daily = 'daily_quest.complete'
const due = '2020-03-05'

async function setupDay(client, assignBoth = false) {
  const target = await addClass(client, { students: ['enrolled', 'enrolled'] })
  const a = await assignTask(client, target, { due_on: due })
  const b = await assignTask(client, target, {
    due_on: due, ...(!assignBoth && { assignee_ids: [target.studentIds[1]] }),
  })
  const rule = await saveEventRule(client, target.classId, daily, 7)
  await saveEventRule(client, target.classId, missingEvent, -20)
  await saveEventRule(client, target.classId, lateEvent, -10)
  const passA = await markSubmission(client, a, 'on_time')
  const rewarded = assignBoth ? await markSubmission(client, b, 'on_time') : passA
  const [reward] = rewarded.result.effects_added
  expect(reward).toMatchObject({ event: daily, subject_key: due, amount: 7 })
  return { a, b, rule, reward }
}

async function checkDay(client, target, rev, basis, status, balance, deductions, reward) {
  await expectSubmissionState(client, target, rev, basis, status, balance, deductions)
  const { rows } = await client.query(`
    SELECT ppt.effective_transaction_amount(t)::int AS amount
    FROM ppt.effects e JOIN ppt.transactions t
      ON t.class_id = e.class_id AND t.transaction_id = e.root_transaction_id
    WHERE e.class_id = $1 AND e.student_id = $2 AND e.event = $3
      AND e.subject_key = $4 AND e.status = 'active'
  `, [target.classId, target.studentId, daily, due])
  expect(rows).toEqual(reward === null ? [] : [{ amount: reward }])
}

function undoReceipt(client, target, receipt) {
  return commitOperation(client, undo(target.classId, receipt.op_id))
}

async function runS4(client, reviseRule = false) {
  const { a, b, rule, reward } = await setupDay(client)
  expect(await submissionRow(client, b)).toBeUndefined()
  await checkDay(client, a, 2, 2, 'on_time', 7, [], 7)
  const missing = await markSubmission(client, b, 'missing', 0)
  await checkDay(client, b, 1, 1, 'missing', -20, [[missingEvent, -20]], null)
  expect(missing.result.effects_reversed).toMatchObject([{ effect_id: reward.effect_id, effective_amount: 7 }])
  if (reviseRule) await commitOperation(client, saveRule(b.classId, { ...rule, amount: 11 }, 1))
  const restored = await undoReceipt(client, b, missing)
  const amount = reviseRule ? 11 : 7
  await checkDay(client, b, 2, 0, 'pending', amount, [], amount)
  await expectSubmissionState(client, a, 2, 2, 'on_time', amount)
  expect(await effectRow(client, b.classId, reward.effect_id)).toMatchObject({ status: 'reversed' })
  expect(restored.result.effects_added).toMatchObject([{ event: daily, amount }])
  const [newReward] = restored.result.effects_added
  expect(newReward.effect_id).not.toBe(reward.effect_id)
  expect(newReward.lineage_id).not.toBe(reward.lineage_id)
  expect(restored.result.transactions).toHaveLength(2)
  expect(await transactionFrom(client, restored, 0)).toMatchObject({
    kind: 'reversal', amount: '20', root_transaction_id: missing.result.effects_added[0].root_transaction_id,
  })
  expect(await transactionFrom(client, restored, 1)).toMatchObject({
    transaction_id: newReward.root_transaction_id, amount: String(amount), kind: 'rule_auto',
    rule_id: rule.rule_id, rule_rev: reviseRule ? 2 : 1, restored_from_transaction_id: null,
  })
  return b
}

describeDatabase('繳交建立與確認的撤銷', () => {
  const database = useTestDatabase()

  test('新建缺交與重建遲交各可撤回不參與', async () => {
    const { client } = database()
    const { b } = await setupDay(client)
    const first = await markSubmission(client, b, 'missing', 0)
    const removed = await undoReceipt(client, b, first)
    expect(removed.changes[0]).toMatchObject({
      prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 0,
      value: { status: 'pending', assignment_active: false },
    })
    expect(await effectRow(client, b.classId, first.result.effects_added[0].effect_id))
      .toMatchObject({ status: 'reversed', reversed_op_id: removed.op_id })
    await checkDay(client, b, 2, 0, 'pending', 7, [], 7)
    const second = await markSubmission(client, b, 'late', 0)
    await checkDay(client, b, 3, 3, 'late', -10, [[lateEvent, -10]], null)
    const secondUndo = await undoReceipt(client, b, second)
    expect(secondUndo.changes[0]).toMatchObject({ rev: 4, prev_basis_rev: 3, basis_rev: 0 })
    await checkDay(client, b, 4, 0, 'pending', 7, [], 7)
  })

  test('回到不參與會取代尚未處理的提議', async () => {
    const { client } = database()
    const { b } = await setupDay(client)
    const first = await markSubmission(client, b, 'pending', 0)
    const proposal = await commitOperation(client, propose(b, 'missing'))
    const receipt = await undoReceipt(client, b, first)
    await checkDay(client, b, 2, 0, 'pending', 7, [], 7)
    expect(await confirmationsFor(client, b.classId)).toMatchObject([
      { confirmation_id: proposal.op_id, status: 'superseded', processed_op_id: receipt.op_id },
    ])
    expect(receipt.changes).toContainEqual(expect.objectContaining({
      entity: 'confirmation', key: { confirmation_id: proposal.op_id },
      value: expect.objectContaining({ status: 'superseded' }),
    }))
  })

  test('撤銷學生提議的確認只回復繳交與扣分，可以重提', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const proposal = await commitOperation(client, propose(target, 'missing'))
    const confirmed = await commitOperation(client, confirm(target.classId, proposal.op_id))
    await expectSubmissionState(client, target, 2, 2, 'missing', -20, [[missingEvent, -20]])
    const receipt = await undoReceipt(client, target, confirmed)
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['submission', 'account'])
    expect(receipt.result.effects_reversed).toMatchObject([{ event: missingEvent, effective_amount: -20 }])
    expect(await confirmationsFor(client, target.classId)).toMatchObject([
      { confirmation_id: proposal.op_id, status: 'confirmed', processed_op_id: confirmed.op_id },
    ])
    await commitOperation(client, propose(target, 'missing'))
  })

  test('03:433 回復遲交保留尚未處理的提議，老師仍可退回', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    await markSubmission(client, target, 'late')
    const pending = await markSubmission(client, target, 'pending', 2)
    const proposal = await commitOperation(client, propose(target, 'missing'))
    const receipt = await undoReceipt(client, target, pending)
    await expectSubmissionState(client, target, 4, 2, 'late', -10, [[lateEvent, -10]])
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['submission', 'account'])
    expect((await submit(client, confirm(target.classId, proposal.op_id))).code).toBe('INVALID_TRANSITION')
    expect(await confirmationsFor(client, target.classId)).toMatchObject([{ status: 'pending' }])
    await commitOperation(client, confirm(target.classId, proposal.op_id, 'confirmation.reject'))
  })

  test('S4 缺交不再參與後重新發獎，新獎勵另起接替鏈', async () => {
    await runS4(database().client)
  })

  test('03:415 撤銷時以每日任務新規則版本補發', async () => {
    await runS4(database().client, true)
  })

  test('S7 兩份作業分別撤銷，直到兩份都準時才補發一次', async () => {
    const { client } = database()
    const { a, b } = await setupDay(client, true)
    await checkDay(client, a, 2, 2, 'on_time', 7, [], 7)
    await expectSubmissionState(client, b, 2, 2, 'on_time', 7)
    const missing = await markSubmission(client, a, 'missing', 2)
    await checkDay(client, a, 3, 3, 'missing', -20, [[missingEvent, -20]], null)
    await expectSubmissionState(client, b, 2, 2, 'on_time', -20)
    const late = await markSubmission(client, b, 'late', 2)
    await checkDay(client, b, 3, 3, 'late', -30, [[lateEvent, -10]], null)
    await expectSubmissionState(client, a, 3, 3, 'missing', -30, [[missingEvent, -20]])
    expect((await undoReceipt(client, a, missing)).result.effects_added).toEqual([])
    await checkDay(client, a, 4, 2, 'on_time', -10, [], null)
    await expectSubmissionState(client, b, 3, 3, 'late', -10, [[lateEvent, -10]])
    expect((await undoReceipt(client, b, late)).result.effects_added).toMatchObject([{ event: daily, amount: 7 }])
    await checkDay(client, b, 4, 2, 'on_time', 7, [], 7)
    await expectSubmissionState(client, a, 4, 2, 'on_time', 7)
  })

  test.each(['on_time', 'missing'])('16.3 第 4 條 S4 結尾重建成 %s', async (status) => {
    const { client } = database()
    const b = await runS4(client)
    const receipt = await markSubmission(client, b, status, 0)
    if (status === 'on_time') {
      expect(receipt.result.transactions).toEqual([])
      await checkDay(client, b, 3, 3, status, 7, [], 7)
    } else {
      expect(receipt.result.effects_reversed).toMatchObject([{ event: daily, effective_amount: 7 }])
      await checkDay(client, b, 3, 3, status, -20, [[missingEvent, -20]], null)
    }
  })

  test.each([0, 2])('16.3 第 8 條不參與繳交以 rev %i 重建為準時', async (rev) => {
    const { client } = database()
    const { b } = await setupDay(client)
    await undoReceipt(client, b, await markSubmission(client, b, 'missing', 0))
    await markSubmission(client, b, 'on_time', rev)
    await checkDay(client, b, 3, 3, 'on_time', 7, [], 7)
  })

  test('舊版點收過的截止日只帶提示，原獎勵保留', async () => {
    const { client } = database()
    const { a, b, reward } = await setupDay(client)
    await client.query(`
      UPDATE ppt.submissions SET legacy_status_at_import = 'on_time'
      WHERE class_id = $1 AND task_id = $2 AND student_id = $3
    `, [a.classId, a.taskId, a.studentId])
    const original = await markSubmission(client, b, 'missing', 0)
    const receipt = await undoReceipt(client, b, original)
    expect(receipt.warnings).toEqual([{ code: 'LEGACY_DAY_NO_DAILY_QUEST', student_id: b.studentId, date: due }])
    expect(receipt.result.effects_added).toEqual([])
    expect(receipt.result.effects_reversed).toMatchObject([{ event: missingEvent }])
    expect(receipt.result.effects_reversed).toHaveLength(1)
    expect(await effectRow(client, a.classId, reward.effect_id)).toMatchObject({ status: 'active' })
    await checkDay(client, b, 2, 0, 'pending', 7, [], 7)
  })
})
