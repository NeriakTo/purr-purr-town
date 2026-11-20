import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { addClass, adjustment } from './test-support/operations.js'
import { commitOperation, restoreTask, saveRule, voidTask } from './test-support/schoolwork.js'
import { assignTask, balanceOf, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const dailyEvent = 'daily_quest.complete'
const due = '2020-03-05'

async function dailyClass(client, options) {
  const target = await addClass(client, options)
  const rule = await saveEventRule(client, target.classId, dailyEvent, 7)
  return { ...target, rule }
}

async function dueTask(client, target, dueOn = due, fields = {}) {
  return assignTask(client, target, { due_on: dueOn, ...fields })
}

async function transactionRows(client, receipt) {
  const { rows } = await client.query(`
    SELECT transaction_id, kind, amount::int, root_transaction_id, rule_id, rule_rev
    FROM ppt.transactions WHERE op_id = $1 ORDER BY array_position($2::text[], transaction_id)
  `, [receipt.op_id, receipt.result.transactions])
  expect(rows.map((row) => row.transaction_id)).toEqual(receipt.result.transactions)
  return rows
}

async function activeRewards(client, { classId, studentId }) {
  const { rows: [{ count }] } = await client.query(`
    SELECT count(*)::int FROM ppt.effects
    WHERE class_id = $1 AND student_id = $2 AND event = $3 AND status = 'active'
  `, [classId, studentId, dailyEvent])
  return count
}

async function setLegacyStatus(client, { classId, taskId, studentId }, status) {
  await client.query(`
    UPDATE ppt.submissions SET legacy_status_at_import = $4
    WHERE class_id = $1 AND task_id = $2 AND student_id = $3
  `, [classId, taskId, studentId, status])
}

function expectReward(receipt, amount = 7) {
  expect(receipt.result.effects_added).toEqual([
    expect.objectContaining({ event: dailyEvent, subject_kind: 'date', subject_key: due, amount }),
  ])
}

describeDatabase('每日任務', () => {
  const database = useTestDatabase()

  test('過去截止日兩份準時才發，隔日待收無關，採現行規則版本', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    const b = await dueTask(client, target)
    await dueTask(client, target, '2020-03-06')
    expect((await markSubmission(client, a, 'on_time')).result.transactions).toEqual([])
    await commitOperation(client, saveRule(target.classId, { ...target.rule, amount: 11 }, 1))
    const receipt = await markSubmission(client, b, 'on_time')
    expectReward(receipt, 11)
    expect(await transactionRows(client, receipt)).toMatchObject([
      { kind: 'rule_auto', amount: 11, rule_id: target.rule.rule_id, rule_rev: 2, root_transaction_id: null },
    ])
    expect(await balanceOf(client, target)).toBe(11)
  })

  test.each([['leave', 'leave', false], ['on_time', 'makeup', true]])(
    '%s 加 %s 的每日任務結果為 %s', async (first, second, rewarded) => {
      const { client } = database()
      const target = await dailyClass(client)
      const a = await dueTask(client, target)
      const b = await dueTask(client, target)
      expect((await markSubmission(client, a, first)).result.transactions).toEqual([])
      const receipt = await markSubmission(client, b, second)
      if (rewarded) expectReward(receipt)
      else expect(receipt.result.transactions).toEqual([])
      expect(await activeRewards(client, target)).toBe(Number(rewarded))
    },
  )

  test.each([7, 0])('規則改版後依根交易有效金額 %s 沖回並結束效果', async (effective) => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    const before = await markSubmission(client, a, 'on_time')
    const [root] = before.result.transactions
    if (effective === 0) {
      await client.query(`
        SELECT ppt.append_account_transaction($1, $2, $3, 'correction', -7, -7,
          clock_timestamp(), $4, '測試更正', $5)
      `, [target.classId, target.studentId, before.op_id, before.committed_at, root])
    }
    await commitOperation(client, saveRule(target.classId, { ...target.rule, amount: 11 }, 1))
    const after = await markSubmission(client, a, 'pending', 2)
    expect(after.result.effects_reversed).toEqual([
      expect.objectContaining({ event: dailyEvent, rule_rev: 1, effective_amount: effective, root_transaction_id: root }),
    ])
    expect(await transactionRows(client, after)).toMatchObject([
      { kind: 'reversal', amount: effective ? -effective : 0, root_transaction_id: root },
    ])
    expect(await activeRewards(client, target)).toBe(0)
    expect(await balanceOf(client, target)).toBe(0)
  })

  test('作業建立、作廢、恢復與同值不判定，真正改成補交才發', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    const b = await dueTask(client, target)
    const c = await dueTask(client, target)
    await markSubmission(client, a, 'on_time')
    await markSubmission(client, c, 'leave')
    await markSubmission(client, b, 'missing')
    for (const op of [voidTask(target.classId, b.taskId, false), restoreTask(target.classId, b.taskId),
      voidTask(target.classId, b.taskId, false, 3)]) {
      expect((await commitOperation(client, op)).result.transactions).toEqual([])
    }
    const duplicate = await markSubmission(client, a, 'on_time', 2)
    expect(duplicate.result).toMatchObject({ noop: true, transactions: [] })
    expectReward(await markSubmission(client, c, 'makeup', 2))
    await dueTask(client, target)
    expect(await activeRewards(client, target)).toBe(1)
    expect(await balanceOf(client, target)).toBe(7)
  })

  test('S7 兩份準時後改缺交再改遲交，各步餘額及帳戶合併正確', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    await saveEventRule(client, target.classId, 'submission.missing', -5)
    await saveEventRule(client, target.classId, 'submission.late', -3)
    const a = await dueTask(client, target)
    const b = await dueTask(client, target)
    await commitOperation(client, adjustment(target, 20))
    await markSubmission(client, a, 'on_time')
    expectReward(await markSubmission(client, b, 'on_time'))
    expect(await balanceOf(client, target)).toBe(27)
    const missing = await markSubmission(client, a, 'missing', 2)
    expect((await transactionRows(client, missing)).map(({ kind, amount }) => [kind, amount]))
      .toEqual([['rule_auto', -5], ['reversal', -7]])
    expect(missing.changes.filter(({ entity }) => entity === 'account')).toEqual([
      expect.objectContaining({ prev_value: { balance: 27, total_earned: 27 }, value: { balance: 15, total_earned: 15 } }),
    ])
    expect(await balanceOf(client, target)).toBe(15)
    const late = await markSubmission(client, b, 'late', 2)
    expect((await transactionRows(client, late)).map(({ kind, amount }) => [kind, amount])).toEqual([['rule_auto', -3]])
    expect(await balanceOf(client, target)).toBe(12)
  })

  test.each([['無繳交', 'missing', 1], ['不參與', 'on_time', 3], ['不參與', 'missing', 3]])(
    'S4 與 16.3 從%s用 rev 0 記 %s', async (start, status, rev) => {
      const { client } = database()
      const target = await dailyClass(client, { students: ['enrolled', 'enrolled'] })
      await saveEventRule(client, target.classId, 'submission.missing', -5)
      const a = await dueTask(client, target)
      const b = await dueTask(client, target, due, { assignee_ids: [target.studentIds[1]] })
      if (start === '不參與') {
        await client.query(`
          INSERT INTO ppt.submissions (class_id, task_id, student_id, rev, basis_rev, assignment_active)
          VALUES ($1, $2, $3, 2, 0, false)
        `, [b.classId, b.taskId, b.studentId])
      }
      expectReward(await markSubmission(client, a, 'on_time'))
      const receipt = await markSubmission(client, b, status, 0)
      expect(await submissionRow(client, b)).toMatchObject({ status, rev, basis_rev: rev, assignment_active: true })
      const missing = status === 'missing'
      expect((await transactionRows(client, receipt)).map(({ amount }) => amount)).toEqual(missing ? [-5, -7] : [])
      expect(await activeRewards(client, target)).toBe(missing ? 0 : 1)
      expect(await balanceOf(client, target)).toBe(missing ? -5 : 7)
    },
  )

  test('舊版已點收的日期保留現有效果，每次真改皆帶提示', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    const b = await dueTask(client, target)
    await markSubmission(client, a, 'on_time')
    expectReward(await markSubmission(client, b, 'on_time'))
    await setLegacyStatus(client, a, 'on_time')
    const warnings = [{ code: 'LEGACY_DAY_NO_DAILY_QUEST', student_id: target.studentId, date: due }]
    for (const [status, rev] of [['pending', 2], ['on_time', 3]]) {
      const receipt = await markSubmission(client, b, status, rev)
      expect(receipt.warnings).toEqual(warnings)
      expect(receipt.result.transactions).toEqual([])
    }
    expect(await activeRewards(client, target)).toBe(1)
    expect(await balanceOf(client, target)).toBe(7)
  })

  test('舊版全待收可發；有舊版 unknown 且無規則仍帶提示', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    await setLegacyStatus(client, a, 'pending')
    const reward = await markSubmission(client, a, 'on_time')
    expectReward(reward)
    expect(reward.warnings).toEqual([])
    const other = await addClass(client)
    const b = await dueTask(client, other)
    await setLegacyStatus(client, b, 'unknown')
    const warning = await markSubmission(client, b, 'on_time')
    expect(warning.warnings).toEqual([{ code: 'LEGACY_DAY_NO_DAILY_QUEST', student_id: other.studentId, date: due }])
    expect(warning.result.transactions).toEqual([])
  })

  test('小野透過批次記準時也依截止日發獎勵', async () => {
    const { client } = database()
    const target = await dailyClass(client)
    const a = await dueTask(client, target)
    await authorizeAgent(client, target.classId)
    const { receipts: [receipt] } = await agentSubmit(client, target.classId, [setStatus(a, 'on_time')])
    expect(receipt.status).toBe('committed')
    expectReward(receipt)
    expect(await balanceOf(client, target)).toBe(7)
  })
})
