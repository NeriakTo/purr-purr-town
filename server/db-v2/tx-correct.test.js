import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, balanceOf, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { submissionRow } from './test-support/submissions.js'
import { addProduct, purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { addLegacyTransaction, correct, transactionFrom } from './test-support/transactions.js'

describeDatabase('OP-26 更正交易', () => {
  const db = useTestDatabase()

  test('追到根交易，多次更正沿用原日期並計入累計加分', async () => {
    const { client } = db()
    const target = await addClass(client)
    const root = await transactionFrom(client, await commitOperation(client, adjustment(target, 100)))
    const first = await commitOperation(client, correct(target.classId, root.transaction_id, 100, 80))
    const changed = await transactionFrom(client, first)
    expect(changed).toMatchObject({
      kind: 'correction', amount: '-20', earned_delta: '-20', root_transaction_id: root.transaction_id,
      effective_at: root.effective_at, reason: '更正' + root.reason,
    })
    expect(first.changes).toEqual([expect.objectContaining({ entity: 'account', value: { balance: 80, total_earned: 80 } })])
    const second = await commitOperation(client, correct(target.classId, changed.transaction_id, 80, 120))
    expect(await transactionFrom(client, second)).toMatchObject({
      amount: '40', earned_delta: '40', root_transaction_id: root.transaction_id, effective_at: root.effective_at,
    })
    expect(await balanceOf(client, target)).toBe(120)
  })

  test('更正新版購買只改餘額', async () => {
    const { client } = db()
    const target = await addClass(client)
    await commitOperation(client, adjustment(target, 10))
    const productId = await addProduct(client, target.classId)
    const bought = await commitOperation(client, purchase({ ...target, productId }))
    const receipt = await commitOperation(client, correct(target.classId, bought.result.transactions[0], -3, -1))
    expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '2', earned_delta: '0' })
    expect(receipt.changes[0].value).toEqual({ balance: 9, total_earned: 10 })
  })

  test('缺交扣分改成零不影響有效效果與繳交版本', async () => {
    const { client } = db()
    const target = await assignTask(client, await addClass(client))
    await saveEventRule(client, target.classId, 'submission.missing', -10)
    const missing = await markSubmission(client, target, 'missing')
    const before = await submissionRow(client, target)
    await commitOperation(client, correct(target.classId, missing.result.transactions[0], -10, 0))
    expect(await submissionRow(client, target)).toEqual(before)
    const { rows } = await client.query('SELECT status FROM ppt.effects WHERE class_id = $1', [target.classId])
    expect(rows).toEqual([{ status: 'active' }])
  })

  test('差額為零，有理由留下交易，空白理由成立但不寫交易', async () => {
    const { client } = db()
    const target = await addClass(client)
    const root = (await commitOperation(client, adjustment(target, 20))).result.transactions[0]
    const memo = await commitOperation(client, correct(target.classId, root, 20, 20, { reason: '記錄緣由' }))
    expect(await transactionFrom(client, memo)).toMatchObject({ amount: '0', reason: '記錄緣由' })
    for (const fields of [{}, { reason: ' \t\n' }]) {
      const empty = await commitOperation(client, correct(target.classId, root, 20, 20, fields))
      expect(empty).toMatchObject({ result: { noop: true, transactions: [] }, changes: [] })
    }
  })

  test('有效金額過期只回根編號與現值，資料快照不變', async () => {
    const { client } = db()
    const target = await addClass(client)
    const id = (await commitOperation(client, adjustment(target, 10))).result.transactions[0]
    const before = await classSnapshot(client, target.classId)
    const receipt = await submit(client, correct(target.classId, id, 100, 80))
    expect(receipt.code).toBe('STALE_STATE')
    expect(receipt.current).toEqual({ transaction_id: id, effective_amount: 10 })
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  test.each(['migration_opening_adjustment', 'legacy_orphan_correction', 'item_use'])('不更正 %s', async (kind) => {
    const { client } = db()
    const target = await addClass(client)
    const id = await addLegacyTransaction(client, target, { kind })
    expect(await submit(client, correct(target.classId, id, 99, 80))).toMatchObject({ code: 'TX_NOT_REVERSIBLE' })
  })

  test('已被狀態變更沖回的交易不能再更正', async () => {
    const { client } = db()
    const target = await assignTask(client, await addClass(client))
    await saveEventRule(client, target.classId, 'submission.missing', -10)
    const missing = await markSubmission(client, target, 'missing')
    const onTime = await markSubmission(client, target, 'on_time', 2)
    for (const id of [missing.result.transactions[0], onTime.result.transactions[0]]) {
      expect(await submit(client, correct(target.classId, id, -10, 80))).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    }
  })

  test('匯入的根交易與舊更正一併算入有效金額', async () => {
    const { client } = db()
    const target = await addClass(client)
    const root = await addLegacyTransaction(client, target, { amount: 20 })
    const changed = await addLegacyTransaction(client, target, { kind: 'correction', amount: -5, root })
    const receipt = await commitOperation(client, correct(target.classId, changed, 15, -5))
    expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '-20', earned_delta: '-20', root_transaction_id: root })
    expect(await balanceOf(client, target)).toBe(-5)
  })

  test('拒絕小數、越界、過長理由、缺鍵、多鍵和 expect', async () => {
    const { client } = db()
    const target = await addClass(client)
    const id = (await commitOperation(client, adjustment(target, 10))).result.transactions[0]
    const base = () => correct(target.classId, id, 10, 20)
    const extra = [correct(target.classId, id, 10, 1.5), correct(target.classId, id, 10, 100001),
      correct(target.classId, id, 10, 20, { reason: '字'.repeat(101) }),
      correct(target.classId, id, undefined, 20), correct(target.classId, id, 10, 20, { unknown: true }),
      { ...base(), expect: { rev: 1 } }]
    for (const op of extra) expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
})
