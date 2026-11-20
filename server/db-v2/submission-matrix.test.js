import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, createTask, restoreTask, retireRule, saveRule, voidTask } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const penalties = {
  late: { event: 'submission.late', amount: -3 },
  missing: { event: 'submission.missing', amount: -7 },
}

// The before-effect column is also the setup for makeup, whose state does not identify a penalty.
const matrix = [
  ['pending → on_time', 'pending', 'on_time'],
  ['on_time → leave', 'on_time', 'leave'],
  ['leave → exempt', 'leave', 'exempt'],
  ['exempt → pending', 'exempt', 'pending'],
  ['pending → late', 'pending', 'late', null, false, 'late'],
  ['on_time → missing', 'on_time', 'missing', null, false, 'missing'],
  ['leave → makeup', 'leave', 'makeup'],
  ['late → exempt', 'late', 'exempt', 'late', true],
  ['late → late', 'late', 'late', 'late'],
  ['late → missing', 'late', 'missing', 'late', true, 'missing'],
  ['late → makeup', 'late', 'makeup', 'late'],
  ['missing → on_time', 'missing', 'on_time', 'missing', true],
  ['missing → late', 'missing', 'late', 'missing', true, 'late'],
  ['missing → missing', 'missing', 'missing', 'missing'],
  ['missing → makeup', 'missing', 'makeup', 'missing'],
  ['makeup（遲交）→ pending', 'makeup', 'pending', 'late', true],
  ['makeup（缺交）→ exempt', 'makeup', 'exempt', 'missing', true],
  ['makeup（無扣分）→ leave', 'makeup', 'leave'],
  ['makeup（遲交）→ late', 'makeup', 'late', 'late'],
  ['makeup（缺交）→ late', 'makeup', 'late', 'missing', true, 'late'],
  ['makeup（無扣分）→ late', 'makeup', 'late', null, false, 'late'],
  ['makeup（缺交）→ missing', 'makeup', 'missing', 'missing'],
  ['makeup（遲交）→ missing', 'makeup', 'missing', 'late', true, 'missing'],
  ['makeup（無扣分）→ missing', 'makeup', 'missing', null, false, 'missing'],
  ['makeup → makeup', 'makeup', 'makeup', 'late'],
]

async function matrixFixture(client, options) {
  const fixture = await addClass(client, options)
  const create = createTask(fixture.classId, options ? { assignee_ids: [fixture.studentId] } : {})
  await commitOperation(client, create)
  const rules = {}
  for (const [name, fields] of Object.entries(penalties)) {
    const rule = saveRule(fixture.classId, { kind: 'event', ...fields })
    await commitOperation(client, rule)
    rules[name] = rule
  }
  return { ...fixture, taskId: create.payload.task_id, create, rules }
}

function appliedPenalty(receipt, rule, rev = 1) {
  const [effect] = receipt.result.effects_added
  expect(effect).toBeDefined()
  return { receipt, effect, ruleId: rule.payload.rule_id, ruleRev: rev, amount: rule.payload.amount }
}

async function postStatus(client, target, status) {
  const before = await submissionRow(client, target)
  return commitOperation(client, setStatus(target, status, { rev: before.rev }))
}

async function arrangeStatus(client, target, status, penalty) {
  let active
  if (penalty) {
    const original = await postStatus(client, target, penalty)
    active = appliedPenalty(original, target.rules[penalty])
  }
  if (status !== 'pending' && status !== penalty) await postStatus(client, target, status)
  return active
}

async function account(client, { classId, studentId }) {
  const { rows: [row] } = await client.query(`
    SELECT balance::int, total_earned::int, rev, last_op_id FROM ppt.accounts
    WHERE class_id = $1 AND student_id = $2
  `, [classId, studentId])
  return row
}

async function assertEffects(client, target, previous, reverse, added, receipt) {
  const { rows } = await client.query(`
    SELECT effect_id, lineage_id, event, subject_kind, subject_key, root_transaction_id,
      rule_id, rule_rev, status, reversed_op_id
    FROM ppt.effects WHERE class_id = $1 AND student_id = $2 AND subject_kind = 'task' AND subject_key = $3
  `, [target.classId, target.studentId, target.taskId])
  const expected = []
  if (previous) {
    const { amount: effectiveAmount, ...identity } = previous.effect
    expected.push({
      ...identity, rule_id: previous.ruleId, rule_rev: previous.ruleRev,
      status: reverse ? 'reversed' : 'active', reversed_op_id: reverse ? receipt.op_id : null,
    })
    expect(receipt.result.effects_reversed).toEqual(reverse ? [{
      ...identity, rule_id: previous.ruleId, rule_rev: previous.ruleRev,
      effective_amount: effectiveAmount, effective_at: previous.receipt.committed_at,
    }] : [])
  } else {
    expect(receipt.result.effects_reversed).toEqual([])
  }
  if (added) {
    const { amount, ...identity } = added.effect
    expect(identity).toEqual({
      effect_id: expect.any(String), lineage_id: identity.effect_id, event: added.event, subject_kind: 'task',
      subject_key: target.taskId, root_transaction_id: receipt.result.transactions.at(-1),
    })
    expect(amount).toBe(added.amount)
    expected.push({
      ...identity, rule_id: added.ruleId, rule_rev: added.ruleRev, status: 'active', reversed_op_id: null,
    })
  } else {
    expect(receipt.result.effects_added).toEqual([])
  }
  const evidence = new Map(rows.map(effect => [effect.effect_id, effect]))
  for (const effect of expected) expect(evidence.get(effect.effect_id)).toEqual(effect)
  expect(rows.filter(effect => effect.status === 'active').map(effect => effect.effect_id).sort())
    .toEqual(expected.filter(effect => effect.status === 'active').map(effect => effect.effect_id).sort())
  const operationEffects = rows.filter(effect =>
    effect.reversed_op_id === receipt.op_id || receipt.result.transactions.includes(effect.root_transaction_id))
  expect(operationEffects).toHaveLength(Number(Boolean(added)) + Number(Boolean(reverse)))
}

async function assertTransactions(client, receipt, previous, reverse, added) {
  const { rows } = await client.query(`
    SELECT transaction_id, kind, amount::int, earned_delta::int, root_transaction_id,
      rule_id, rule_rev, occurred_at, effective_at
    FROM ppt.transactions WHERE op_id = $1
  `, [receipt.op_id])
  const expected = []
  const at = new Date(receipt.committed_at)
  if (reverse) expected.push({
    kind: 'reversal', amount: -previous.amount, earned_delta: -previous.amount,
    root_transaction_id: previous.effect.root_transaction_id, rule_id: null, rule_rev: null,
    occurred_at: at, effective_at: new Date(previous.receipt.committed_at),
  })
  if (added) expected.push({
    kind: 'rule_auto', amount: added.amount, earned_delta: added.amount,
    root_transaction_id: null, rule_id: added.ruleId, rule_rev: added.ruleRev,
    occurred_at: at, effective_at: at,
  })
  const transactions = new Map(rows.map(({ transaction_id: id, ...value }) => [id, value]))
  expect(receipt.result.transactions).toHaveLength(expected.length)
  expect(rows).toHaveLength(expected.length)
  expect(receipt.result.transactions.map(id => transactions.get(id))).toEqual(expected)
  return expected.reduce((sum, transaction) => sum + transaction.amount, 0)
}

async function assertChanges(client, target, before, beforeAccount, status, receipt, delta) {
  const noop = before.assignment_active && before.status === status
  const rev = before.rev + Number(!noop)
  const basis = noop ? before.basis_rev : rev
  const current = { status, assignment_active: true }
  const changes = [{
    entity: 'submission', key: { task_id: target.taskId, student_id: target.studentId },
    prev_rev: before.rev, rev, prev_basis_rev: before.basis_rev, basis_rev: basis, last_op_id: receipt.op_id,
    prev_value: { status: before.status, assignment_active: before.assignment_active }, value: current,
  }]
  const balance = beforeAccount.balance + delta
  const earned = beforeAccount.total_earned + delta
  const writes = receipt.result.transactions.length
  if (writes > 0) changes.push({
    entity: 'account', key: { student_id: target.studentId }, prev_rev: beforeAccount.rev,
    rev: beforeAccount.rev + writes, last_op_id: receipt.op_id,
    prev_value: { balance: beforeAccount.balance, total_earned: beforeAccount.total_earned },
    value: { balance, total_earned: earned },
  })
  expect(receipt.result.noop).toBe(noop)
  expect(receipt.changes).toEqual(changes)
  expect(await account(client, target)).toEqual({
    balance, total_earned: earned, rev: beforeAccount.rev + writes,
    last_op_id: writes ? receipt.op_id : beforeAccount.last_op_id,
  })
  expect(await submissionRow(client, target)).toEqual({
    ...current, rev, basis_rev: basis, last_op_id: noop ? before.last_op_id : receipt.op_id,
  })
}

async function checkTransition(client, target, status, {
  previous, reverse = false, add, ruleRev = 1, version,
} = {}) {
  const before = await submissionRow(client, target)
  const beforeAccount = await account(client, target)
  const receipt = await commitOperation(client, setStatus(target, status, version ?? { rev: before.rev }))
  let added
  if (add) {
    expect(receipt.result.effects_added).toHaveLength(1)
    added = { ...appliedPenalty(receipt, target.rules[add], ruleRev), event: penalties[add].event }
  }
  const delta = await assertTransactions(client, receipt, previous, reverse, added)
  await assertEffects(client, target, previous, reverse, added, receipt)
  await assertChanges(client, target, before, beforeAccount, status, receipt, delta)
  return receipt
}

describeDatabase('6.4 繳交矩陣與版本串接', () => {
  const database = useTestDatabase()

  test.each(matrix)('%s', async (_name, from, to, penalty, reverse, add) => {
    const { client } = database()
    const target = await matrixFixture(client)
    const previous = await arrangeStatus(client, target, from, penalty)
    await checkTransition(client, target, to, { previous, reverse, add })
  })

  test.each([['late', 'late'], ['on_time', undefined]])('缺交已沖回後改 %s', async (status, add) => {
    const { client } = database()
    const target = await matrixFixture(client)
    const { classId, taskId } = target
    await postStatus(client, target, 'missing')
    await commitOperation(client, voidTask(classId, taskId, true))
    await commitOperation(client, restoreTask(classId, taskId))
    expect(await submissionRow(client, target)).toMatchObject({ status: 'missing', rev: 2, basis_rev: 2 })
    await checkTransition(client, target, status, { add })
  })

  test('舊資料 unknown 等同待收再記缺交', async () => {
    const { client } = database()
    const target = await matrixFixture(client)
    await client.query(`
      UPDATE ppt.submissions SET status = 'unknown', legacy_status_at_import = 'unknown'
      WHERE class_id = $1 AND task_id = $2 AND student_id = $3
    `, [target.classId, target.taskId, target.studentId])
    await checkTransition(client, target, 'missing', { add: 'missing' })
  })

  test('不參與的列帶 rev 0 重新建立並扣缺交', async () => {
    const { client } = database()
    const target = await matrixFixture(client)
    await client.query(`
      UPDATE ppt.submissions SET assignment_active = false, rev = 4, basis_rev = 0
      WHERE class_id = $1 AND task_id = $2 AND student_id = $3
    `, [target.classId, target.taskId, target.studentId])
    await checkTransition(client, target, 'missing', { add: 'missing', version: { rev: 0 } })
  })

  test('改規則仍退原金額，新扣用新版本，停用只擋新扣分', async () => {
    const { client } = database()
    const target = await matrixFixture(client)
    const previous = await arrangeStatus(client, target, 'missing', 'missing')
    const revised = saveRule(target.classId, { ...target.rules.missing.payload, amount: -11 }, 1)
    await commitOperation(client, revised)
    await checkTransition(client, target, 'on_time', { previous, reverse: true })
    target.rules.missing = revised
    const next = await checkTransition(client, target, 'missing', { add: 'missing', ruleRev: 2 })
    await commitOperation(client, retireRule(target.classId, revised.payload.rule_id, 2))
    await checkTransition(client, target, 'on_time', {
      previous: appliedPenalty(next, revised, 2), reverse: true,
    })
    await checkTransition(client, target, 'missing')
  })

  test('建立後點收可接 OP-10 收據，未指派的學生版本不符', async () => {
    const { client } = database()
    const target = await matrixFixture(client, { students: ['enrolled', 'enrolled'] })
    const version = { after_op: target.create.op_id }
    await checkTransition(client, target, 'on_time', { version })
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, setStatus({ ...target, studentId: target.studentIds[1] }, 'on_time', version)))
      .toMatchObject({ code: 'STALE_STATE', current: { rev: 0, value: null } })
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  test('同值成立的 OP-14 仍可作為 after_op 版本依據', async () => {
    const { client } = database()
    const target = await matrixFixture(client)
    const unchanged = await checkTransition(client, target, 'pending')
    await checkTransition(client, target, 'on_time', { version: { after_op: unchanged.op_id } })
  })
})
