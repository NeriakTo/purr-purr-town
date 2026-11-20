import { expect, test } from 'vitest'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { addProduct, purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function fund(client, classId, studentId) {
  expect(await submit(client, adjustment({ classId, studentId }, 5000))).toMatchObject({ code: 'OK' })
}

async function stockOf(client, classId, productId) {
  const { rows: [product] } = await client.query(
    'SELECT stock FROM ppt.products WHERE class_id = $1 AND product_id = $2', [classId, productId],
  )
  return product.stock
}

describeDatabase('OP-31 購買', () => {
  const db = useTestDatabase()

  test('五十次競買最後一件，每次庫存歸零且只有一人扣款', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const [left, right] = await Promise.all([connect(), connect()])
    await Promise.all(fixture.studentIds.map(studentId => fund(client, fixture.classId, studentId)))
    for (let trial = 0; trial < 50; trial += 1) {
      const productId = await addProduct(client, fixture.classId)
      const receipts = await Promise.all([left, right].map((worker, index) =>
        submit(worker, purchase({ ...fixture, productId, studentId: fixture.studentIds[index] })),
      ))
      expect(receipts.map(receipt => receipt.code).sort()).toEqual(['OK', 'OUT_OF_STOCK'])
      expect(await stockOf(client, fixture.classId, productId)).toBe(0)
    }
    const { rows: [totals] } = await client.query(`
      SELECT
        (SELECT count(*)::int FROM ppt.inventory_items WHERE class_id = $1) AS items,
        (SELECT count(*)::int FROM ppt.transactions WHERE class_id = $1 AND kind = 'shop_purchase') AS purchases
    `, [fixture.classId])
    expect(totals).toEqual({ items: 50, purchases: 50 })
  }, 15000)

  test.each([
    ['價格先於售完與餘額', 0, 4, 'PRICE_CHANGED'],
    ['售完先於餘額', 0, 3, 'OUT_OF_STOCK'],
    ['空庫存視為售完', null, 3, 'OUT_OF_STOCK'],
    ['庫存足夠但餘額不足', 1, 3, 'INSUFFICIENT_BALANCE'],
  ])('%s', async (_label, stock, seenPrice, code) => {
    const { client } = db()
    const fixture = await addClass(client)
    const productId = await addProduct(client, fixture.classId, { stock })
    expect(await submit(client, purchase({ ...fixture, productId }, seenPrice))).toMatchObject({ status: 'rejected', code })
  })

  test.each([
    ['point', 3, null],
    ['fish', 300, null],
    ['cookie', 3000, null],
    ['fish', 21, { tier1: { rate: 7 }, tier2: { rate: 11 } }],
    ['cookie', 33, { tier1: { rate: 7 }, tier2: { rate: 11 } }],
  ])('以 %s 換算為 %i 積分', async (unit, price, currency) => {
    const { client } = db()
    const fixture = await addClass(client)
    const productId = await addProduct(client, fixture.classId, { unit })
    if (currency) await client.query(
      "INSERT INTO ppt.settings_entries (class_id, key, value) VALUES ($1, 'currency', $2)", [fixture.classId, currency],
    )
    await fund(client, fixture.classId, fixture.studentId)
    const receipt = await submit(client, purchase({ ...fixture, productId }, price))
    expect(receipt).toMatchObject({ code: 'OK', result: { transactions: [expect.any(String)] } })
    const { rows } = await client.query('SELECT amount, earned_delta FROM ppt.transactions WHERE op_id = $1', [receipt.op_id])
    expect(rows).toEqual([{ amount: String(-price), earned_delta: '0' }])
  })

  test('庫存充足可連買，第一筆收據完整保留購買前後值', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const productId = await addProduct(client, fixture.classId, { stock: 2 })
    await fund(client, fixture.classId, fixture.studentId)
    const op = purchase({ ...fixture, productId })
    const receipt = await submit(client, op)
    expect(receipt).toMatchObject({ code: 'OK', result: { noop: false, effects_added: [], effects_reversed: [] } })
    const [transactionId] = receipt.result.transactions
    expect(receipt.changes).toEqual([
      {
        entity: 'inventory_item', key: { item_id: op.payload.item_id }, prev_rev: 0, rev: 1,
        last_op_id: op.op_id, prev_value: null,
        value: {
          student_id: fixture.studentId, product_id: productId, product_name: '試用道具',
          product_icon: '☆', purchase_transaction_id: transactionId, status: 'held',
        },
      },
      {
        entity: 'product', key: { product_id: productId }, prev_rev: 1, rev: 2, last_op_id: op.op_id,
        prev_value: { stock: 2 }, value: { stock: 1 },
      },
      {
        entity: 'account', key: { student_id: fixture.studentId }, prev_rev: 2, rev: 3, last_op_id: op.op_id,
        prev_value: { balance: 5000, total_earned: 5000 }, value: { balance: 4997, total_earned: 5000 },
      },
    ])
    expect(await submit(client, purchase({ ...fixture, productId }))).toMatchObject({ code: 'OK' })
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await stockOf(client, fixture.classId, productId)).toBe(0)
  })
})
