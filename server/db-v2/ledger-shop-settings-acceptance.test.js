import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { buyItem, useItem } from './test-support/inventory.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { retireProduct, saveProduct } from './test-support/products.js'
import { commitOperation, operation, saveRule } from './test-support/schoolwork.js'
import { currency, setSetting } from './test-support/settings.js'
import { purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse } from './test-support/transactions.js'

function applyRule(target, ids) {
  return operation(target.classId, 'points.apply_rule', {
    student_id: ids.studentId, rule_id: ids.ruleId, rule_version: 1,
  })
}

async function createTargets(client) {
  const target = await addClass(client)
  const rule = saveRule(target.classId)
  const product = saveProduct(target.classId)
  const tx = await commitOperation(client, adjustment(target, 10))
  await commitOperation(client, rule)
  await commitOperation(client, product)
  const itemId = await buyItem(client, target, product.payload.product_id)
  return {
    ...target, ruleId: rule.payload.rule_id, productId: product.payload.product_id,
    transactionId: tx.result.transactions[0], itemId,
  }
}

const cases = [
  ['OP-25', false, applyRule],
  ['OP-26', false, (target, ids) => correct(target.classId, ids.transactionId, 10, 5)],
  ['OP-27', false, (target, ids) => reverse(target.classId, ids.transactionId, 10)],
  ['OP-32', false, (target, ids) => useItem(target.classId, ids.itemId)],
  ['OP-33', true, (target, ids) => saveProduct(target.classId, { product_id: ids.productId })],
  ['OP-34', true, (target, ids) => retireProduct(target.classId, ids.productId, 2)],
  ['OP-43', true, (target) => setSetting(target.classId, 'shopMeta', { title: '測試商店' })],
]

async function asAgent(client, op) {
  const { receipts: [receipt] } = await agentSubmit(client, op.class_id, [op])
  return receipt
}

async function assertCrossClass(client, label, make, first, second) {
  const before = await classSnapshot(client, second.classId)
  if (label === 'OP-43') {
    const key = 'shopMeta'
    await commitOperation(client, setSetting(second.classId, key, { title: '乙班' }))
    const withSetting = await classSnapshot(client, second.classId)
    await commitOperation(client, make(first, second))
    expect(await classSnapshot(client, second.classId)).toBe(withSetting)
    return
  }
  if (label === 'OP-33') {
    const receipt = await commitOperation(client, make(first, second))
    expect(receipt.changes[0]).toMatchObject({ key: { product_id: second.productId }, prev_rev: 0, rev: 1 })
  } else {
    const receipt = await submit(client, make(first, second))
    expect(receipt.code).toBe('NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  }
  if (label === 'OP-25') {
    const receipt = await asAgent(client, make(first, { ...first, studentId: second.studentId }))
    expect(receipt.code).toBe('SCOPE_FORBIDDEN')
    expect(receipt).not.toHaveProperty('current')
  }
  expect(await classSnapshot(client, second.classId)).toBe(before)
}

describeDatabase('本包操作的版本條件與共用拒絕', () => {
  const db = useTestDatabase()

  test('先存新匯率再建商品，購買採二十一點，拒絕預設三百點', async () => {
    const { client } = db()
    const target = await addClass(client)
    await commitOperation(client, setSetting(target.classId, 'currency', currency(7)))
    const product = saveProduct(target.classId, { price_unit: 'fish', price: 3 })
    await commitOperation(client, product)
    await commitOperation(client, adjustment(target, 500))
    const purchaseTarget = { ...target, productId: product.payload.product_id }
    expect(await submit(client, purchase(purchaseTarget, 300))).toMatchObject({ code: 'PRICE_CHANGED' })
    const receipt = await commitOperation(client, purchase(purchaseTarget, 21))
    expect(receipt.changes[2].value).toEqual({ balance: 479, total_earned: 500 })
  })

  test.each(cases)('%s 拒絕無效的 expect 形狀', async (_label, required, make) => {
    const { client } = db()
    const target = await createTargets(client)
    const malformed = required ? [undefined, null, {}, { rev: 1, after_op: '另一筆' }, 1] : [{ rev: 1 }, null]
    for (const expectVersion of malformed) {
      const op = make(target, target)
      if (expectVersion === undefined) delete op.expect
      else op.expect = expectVersion
      expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })

  test.each(cases)('%s 驗身分、封存、輸入鍵與跨班隔離', async (label, _required, make) => {
    const { client } = db()
    const first = await createTargets(client)
    const second = await createTargets(client)
    await authorizeAgent(client, first.classId)
    if (label !== 'OP-25') {
      expect(await asAgent(client, make(first, first))).toMatchObject({ code: 'FORBIDDEN_ROLE' })
    }
    const extra = make(first, first)
    extra.payload.unknown = true
    expect(await submit(client, extra)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    await assertCrossClass(client, label, make, first, second)
    const archived = await addClass(client, { status: 'archived' })
    expect(await submit(client, make(archived, first))).toMatchObject({ code: 'CLASS_ARCHIVED' })
  })
})
