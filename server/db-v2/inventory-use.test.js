import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { buyItem, useItem } from './test-support/inventory.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { addProduct } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'

async function inventoryRow(client, classId, itemId) {
  const { rows: [row] } = await client.query('SELECT * FROM ppt.inventory_items WHERE class_id = $1 AND item_id = $2',
    [classId, itemId])
  return row
}

describeDatabase('OP-32 使用道具', () => {
  const db = useTestDatabase()

  test('使用購買的物品推進物品與帳戶版本，點數不變', async () => {
    const { client } = db()
    const target = await addClass(client)
    const productId = await addProduct(client, target.classId)
    const itemId = await buyItem(client, target, productId)
    const receipt = await commitOperation(client, useItem(target.classId, itemId))
    expect(await inventoryRow(client, target.classId, itemId)).toMatchObject({
      status: 'used', rev: 2, last_op_id: receipt.op_id,
    })
    expect(receipt.changes).toMatchObject([
      { entity: 'inventory_item', prev_value: { status: 'held' }, value: { status: 'used' } },
      { entity: 'account', prev_rev: 3, rev: 4, prev_value: { balance: 10, total_earned: 13 },
        value: { balance: 10, total_earned: 13 } },
    ])
    const tx = await transactionFrom(client, receipt)
    expect(tx).toMatchObject({ kind: 'item_use', amount: '0', earned_delta: '0', reason: '使用道具試用道具' })
    for (const op of [correct(target.classId, tx.transaction_id, 0, 5), reverse(target.classId, tx.transaction_id, 0)]) {
      expect(await submit(client, op)).toMatchObject({ code: 'TX_NOT_REVERSIBLE' })
    }
    expect(await submit(client, useItem(target.classId, itemId))).toMatchObject({ code: 'ITEM_ALREADY_USED' })
  })

  test('使用匯入道具允許舊文字編號、已轉出與停用商品', async () => {
    const { client } = db()
    const { classId, studentId } = await addClass(client, { students: ['transferred'] })
    const productId = 'a'.repeat(64)
    const itemId = 'b'.repeat(64)
    await client.query(`
      INSERT INTO ppt.products (class_id, product_id, name, price, price_unit, disabled)
      VALUES ($1, $2, '匯入商品', 3, 'point', true)
    `, [classId, productId])
    await client.query(`
      INSERT INTO ppt.inventory_items (class_id, item_id, student_id, product_id, product_name)
      VALUES ($1, $2, $3, $4, '購買時品名')
    `, [classId, itemId, studentId, productId])
    const receipt = await commitOperation(client, useItem(classId, itemId))
    expect(await transactionFrom(client, receipt)).toMatchObject({ reason: '使用道具購買時品名' })
  })

  test('已退回、未知物品及多餘輸入依序拒絕', async () => {
    const { client } = db()
    const target = await addClass(client)
    const productId = await addProduct(client, target.classId)
    const itemId = await buyItem(client, target, productId)
    await client.query("UPDATE ppt.inventory_items SET status = 'returned' WHERE class_id = $1 AND item_id = $2",
      [target.classId, itemId])
    const returned = useItem(target.classId, itemId)
    expect(await submit(client, returned)).toMatchObject({ code: 'INVALID_TRANSITION' })
    expect(await submit(client, useItem(target.classId, randomUUID()))).toMatchObject({ code: 'NOT_FOUND' })
    const extra = useItem(target.classId, itemId)
    extra.payload.extra = true
    for (const op of [extra, { ...useItem(target.classId, itemId), expect: { rev: 1 } }]) {
      expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })
})
