import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { commitOperation, operation, saveRule } from './test-support/schoolwork.js'
import { assignTask, balanceOf, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'

async function prepareDeductions(client) {
  const target = await assignTask(client, await addClass(client))
  await saveEventRule(client, target.classId, 'submission.missing', -20)
  await saveEventRule(client, target.classId, 'submission.late', -10)
  return target
}

async function effectsFor(client, classId) {
  const { rows } = await client.query('SELECT status, event FROM ppt.effects WHERE class_id = $1 ORDER BY event', [classId])
  return rows
}

describeDatabase('存摺、繳交與根交易驗收', () => {
  const db = useTestDatabase()

  test('更正至零的缺交扣分由系統寫唯一一筆零元沖回', async () => {
    const { client } = db()
    const target = await prepareDeductions(client)
    const missing = await markSubmission(client, target, 'missing')
    const id = missing.result.transactions[0]
    await commitOperation(client, correct(target.classId, id, -20, 0))
    expect(await balanceOf(client, target)).toBe(0)
    expect(await effectsFor(client, target.classId)).toEqual([{ status: 'active', event: 'submission.missing' }])
    const receipt = await markSubmission(client, target, 'on_time', 2)
    expect(receipt.result.effects_reversed).toMatchObject([{ root_transaction_id: id, effective_amount: 0 }])
    const { rows } = await client.query(`
      SELECT amount, earned_delta FROM ppt.transactions
      WHERE class_id = $1 AND root_transaction_id = $2 AND kind = 'reversal'
    `, [target.classId, id])
    expect(rows).toEqual([{ amount: '0', earned_delta: '0' }])
    expect(await effectsFor(client, target.classId)).toEqual([{ status: 'reversed', event: 'submission.missing' }])
    for (const op of [correct(target.classId, id, 0, -5), reverse(target.classId, id, 0)]) {
      expect(await submit(client, op)).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    }
  })

  test('直接沖回有效金額零的缺交扣分被拒，效果仍有效', async () => {
    const { client } = db()
    const target = await prepareDeductions(client)
    const id = (await markSubmission(client, target, 'missing')).result.transactions[0]
    await commitOperation(client, correct(target.classId, id, -20, 0))
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, reverse(target.classId, id, 0))).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    expect(await effectsFor(client, target.classId)).toEqual([{ status: 'active', event: 'submission.missing' }])
  })

  test('更正遲交扣分後改缺交，依更正後金額沖回並保存快照', async () => {
    const { client } = db()
    const target = await prepareDeductions(client)
    const id = (await markSubmission(client, target, 'late')).result.transactions[0]
    await commitOperation(client, correct(target.classId, id, -10, -8))
    const missing = await markSubmission(client, target, 'missing', 2)
    expect(missing.result.effects_reversed).toMatchObject([{ root_transaction_id: id, effective_amount: -8 }])
    expect(await transactionFrom(client, missing)).toMatchObject({ kind: 'reversal', amount: '8' })
    expect(await balanceOf(client, target)).toBe(-20)
    expect(await submissionRow(client, target)).toMatchObject({ status: 'missing', rev: 3, basis_rev: 3 })
  })

  test('補交後手動沖回缺交扣分，保留補交版本且餘額歸零', async () => {
    const { client } = db()
    const target = await prepareDeductions(client)
    const id = (await markSubmission(client, target, 'missing')).result.transactions[0]
    await markSubmission(client, target, 'makeup', 2)
    await commitOperation(client, reverse(target.classId, id, -20))
    expect(await submissionRow(client, target)).toMatchObject({ status: 'makeup', rev: 3, basis_rev: 3 })
    expect(await balanceOf(client, target)).toBe(0)
    expect(await effectsFor(client, target.classId)).toEqual([{ status: 'reversed', event: 'submission.missing' }])
  })

  test('遲交扣十改扣八，餘額減八且繳交版本不動', async () => {
    const { client } = db()
    const target = await prepareDeductions(client)
    const id = (await markSubmission(client, target, 'late')).result.transactions[0]
    const before = await submissionRow(client, target)
    await commitOperation(client, correct(target.classId, id, -10, -8))
    expect(await balanceOf(client, target)).toBe(-8)
    expect(await submissionRow(client, target)).toEqual(before)
  })

  test.each([['更正', (classId, id) => correct(classId, id, 10, 5)], ['沖回', (classId, id) => reverse(classId, id, 10)]])(
    '%s查不到另一班的交易，且沒有現值', async (_name, makeOperation) => {
      const { client } = db()
      const first = await addClass(client)
      const second = await addClass(client)
      const id = (await commitOperation(client, adjustment(second, 10))).result.transactions[0]
      const before = await classSnapshot(client, second.classId)
      const receipt = await submit(client, makeOperation(first.classId, id))
      expect(receipt.code).toBe('NOT_FOUND')
      expect(receipt).not.toHaveProperty('current')
      expect(await classSnapshot(client, second.classId)).toBe(before)
    },
  )

  test('先前的規則套用雖已沖回，小野再次套用仍提示', async () => {
    const { client } = db()
    const { classId, studentId } = await addClass(client)
    await authorizeAgent(client, classId)
    const rule = saveRule(classId)
    await commitOperation(client, rule)
    const payload = { student_id: studentId, rule_id: rule.payload.rule_id, rule_version: 1 }
    const prior = await commitOperation(client, operation(classId, 'points.apply_rule', payload))
    await commitOperation(client, reverse(classId, prior.result.transactions[0], 5))
    const { receipts: [receipt] } = await agentSubmit(client, classId, [operation(classId, 'points.apply_rule', payload)])
    expect(receipt.warnings).toMatchObject([{ code: 'POSSIBLE_DUPLICATE', prior_op_id: prior.op_id }])
  })
})
