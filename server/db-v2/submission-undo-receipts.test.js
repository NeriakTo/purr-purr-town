import { expect, test } from 'vitest'
import { confirm, propose } from './test-support/confirmations.js'
import { addClass } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const daily = 'daily_quest.complete'
const missing = 'submission.missing'

async function assertUndoFields(client, receipt, { added, reversed, entities }) {
  expect(receipt.changes.map(({ entity }) => entity)).toEqual(entities)
  for (const change of receipt.changes) {
    expect(change).toMatchObject({
      entity: expect.any(String), key: expect.any(Object), prev_rev: expect.any(Number), rev: expect.any(Number),
      last_op_id: receipt.op_id,
    })
    expect(change).toHaveProperty('prev_value')
    expect(change).toHaveProperty('value')
    if (change.entity === 'submission') {
      expect(change).toMatchObject({ prev_basis_rev: expect.any(Number), basis_rev: expect.any(Number) })
    }
  }

  const effectIdentity = {
    effect_id: expect.any(String), lineage_id: expect.any(String),
    subject_kind: expect.any(String), subject_key: expect.any(String), root_transaction_id: expect.any(String),
  }
  expect(receipt.result.effects_added).toMatchObject(
    added.map((event) => ({ ...effectIdentity, event, amount: expect.any(Number) })),
  )
  expect(receipt.result.effects_reversed).toMatchObject(reversed.map((event) => ({
    ...effectIdentity, event, rule_id: expect.any(String), rule_rev: expect.any(Number),
    effective_amount: expect.any(Number), effective_at: expect.any(String),
  })))
  const { rows } = await client.query(`
    SELECT transaction_id FROM ppt.transactions WHERE op_id = $1
    ORDER BY array_position($2::text[], transaction_id)
  `, [receipt.op_id, receipt.result.transactions])
  expect(receipt.result.transactions).toEqual(rows.map(({ transaction_id }) => transaction_id))
}

async function eventFixture(client) {
  const target = await assignTask(client, await addClass(client))
  await saveEventRule(client, target.classId, daily, 7)
  await saveEventRule(client, target.classId, missing, -5)
  return target
}

describeDatabase('提供撤銷使用的繳交收據', () => {
  const database = useTestDatabase()

  test('確認提議收據含繳交基準、待確認項目及兩類效果', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    await markSubmission(client, target, 'on_time')
    const second = await assignTask(client, target)
    const proposal = await commitOperation(client, propose(second, 'missing'))
    const receipt = await commitOperation(client, confirm(target.classId, proposal.op_id))
    await assertUndoFields(client, receipt, {
      added: [missing], reversed: [daily], entities: ['submission', 'account', 'confirmation'],
    })
  })

  test('每日任務的新增與沖回在各自效果清單可用事件識別', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    const first = await markSubmission(client, target, 'on_time')
    const second = await markSubmission(client, target, 'missing', 2)
    await assertUndoFields(client, first, { added: [daily], reversed: [], entities: ['submission', 'account'] })
    await assertUndoFields(client, second, { added: [missing], reversed: [daily], entities: ['submission', 'account'] })
    expect(second.result.effects_reversed[0]).toMatchObject({
      root_transaction_id: first.result.transactions[0], effective_amount: 7, effective_at: first.committed_at,
    })
  })

  test('OP-14 順帶取代提議可由 entity 識別，保留其繳交與扣分資料', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    const proposal = await commitOperation(client, propose(target, 'late'))
    const receipt = await markSubmission(client, target, 'missing')
    await assertUndoFields(client, receipt, {
      added: [missing], reversed: [], entities: ['submission', 'account', 'confirmation'],
    })
    expect(receipt.changes.find(({ entity }) => entity === 'confirmation')).toMatchObject({
      key: { confirmation_id: proposal.op_id }, prev_value: { status: 'pending' }, value: { status: 'superseded' },
    })
  })
})

describeDatabase('提供撤銷使用的存摺與道具收據', () => {
  const database = useTestDatabase()

  test('OP-25 收據完整列出一筆交易與帳戶前後值', async () => {
    const { operation, saveRule } = await import('./test-support/schoolwork.js')
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const rule = saveRule(classId)
    await commitOperation(client, rule)
    const op = operation(classId, 'points.apply_rule', {
      student_id: studentId, rule_id: rule.payload.rule_id, rule_version: 1,
    })
    const receipt = await commitOperation(client, op)
    await assertUndoFields(client, receipt, { added: [], reversed: [], entities: ['account'] })
    expect(receipt.changes[0]).toMatchObject({
      key: { student_id: studentId }, prev_value: { balance: 0, total_earned: 0 },
      value: { balance: 5, total_earned: 5 },
    })
    expect(receipt.result.transactions).toHaveLength(1)
  })

  test('OP-26 收據可追回根交易，無改動時交易清單為空', async () => {
    const { adjustment } = await import('./test-support/operations.js')
    const { correct, transactionFrom } = await import('./test-support/transactions.js')
    const { client } = database()
    const target = await addClass(client)
    const root = await transactionFrom(client, await commitOperation(client, adjustment(target, 10)))
    const receipt = await commitOperation(client, correct(target.classId, root.transaction_id, 10, 8))
    await assertUndoFields(client, receipt, { added: [], reversed: [], entities: ['account'] })
    expect(receipt.result.transactions).toHaveLength(1)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'correction', root_transaction_id: root.transaction_id,
    })
    const noop = await commitOperation(client, correct(target.classId, root.transaction_id, 8, 8))
    await assertUndoFields(client, noop, { added: [], reversed: [], entities: [] })
    expect(noop.result).toMatchObject({ noop: true, transactions: [] })
  })

  test('OP-32 收據依序列狀態與帳戶，交易是唯一的零元使用紀錄', async () => {
    const { buyItem, useItem } = await import('./test-support/inventory.js')
    const { saveProduct } = await import('./test-support/products.js')
    const { transactionFrom } = await import('./test-support/transactions.js')
    const { client } = database()
    const target = await addClass(client)
    const product = saveProduct(target.classId)
    await commitOperation(client, product)
    const itemId = await buyItem(client, target, product.payload.product_id)
    const receipt = await commitOperation(client, useItem(target.classId, itemId))
    await assertUndoFields(client, receipt, { added: [], reversed: [], entities: ['inventory_item', 'account'] })
    expect(receipt.changes[0].prev_value).toEqual({ status: 'held' })
    expect(receipt.changes[0].value).toEqual({ status: 'used' })
    expect(receipt.result.transactions).toHaveLength(1)
    expect(await transactionFrom(client, receipt)).toMatchObject({ kind: 'item_use', amount: '0', earned_delta: '0' })
  })
})

describeDatabase('提供撤銷使用的調整與購買收據', () => {
  const database = useTestDatabase()

  test('OP-24 收據只有帳戶與一筆調整交易', async () => {
    const { adjustment } = await import('./test-support/operations.js')
    const { transactionFrom } = await import('./test-support/transactions.js')
    const { client } = database()
    const target = await addClass(client)
    const receipt = await commitOperation(client, adjustment(target, 10))
    await assertUndoFields(client, receipt, { added: [], reversed: [], entities: ['account'] })
    expect(receipt.changes[0]).toMatchObject({
      key: { student_id: target.studentId }, prev_value: { balance: 0, total_earned: 0 },
      value: { balance: 10, total_earned: 10 },
    })
    expect(receipt.result.transactions).toHaveLength(1)
    expect(await transactionFrom(client, receipt)).toMatchObject({ kind: 'adjust' })
  })

  test('OP-31 收據依序列物品、商品與帳戶，可追回購買交易', async () => {
    const { adjustment } = await import('./test-support/operations.js')
    const { saveProduct } = await import('./test-support/products.js')
    const { purchase } = await import('./test-support/shop.js')
    const { transactionFrom } = await import('./test-support/transactions.js')
    const { client } = database()
    const target = await addClass(client)
    const product = saveProduct(target.classId)
    await commitOperation(client, product)
    await commitOperation(client, adjustment(target, 10))
    const op = purchase({ ...target, productId: product.payload.product_id })
    const receipt = await commitOperation(client, op)
    await assertUndoFields(client, receipt, {
      added: [], reversed: [], entities: ['inventory_item', 'product', 'account'],
    })
    expect(receipt.result.transactions).toHaveLength(1)
    expect(await transactionFrom(client, receipt)).toMatchObject({ kind: 'shop_purchase' })
    expect(receipt.changes[0]).toMatchObject({
      key: { item_id: op.payload.item_id }, prev_rev: 0, prev_value: null,
      value: { status: 'held', purchase_transaction_id: receipt.result.transactions[0] },
    })
    expect(receipt.changes[1].key).toEqual({ product_id: product.payload.product_id })
    expect(receipt.changes[1].prev_value).toEqual({ stock: 3 })
    expect(receipt.changes[1].value).toEqual({ stock: 2 })
  })
})
