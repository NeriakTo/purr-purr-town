import { expect, test } from 'vitest'
import { buyItem, useItem } from './test-support/inventory.js'
import { addClass, submit } from './test-support/operations.js'
import { retireProduct, saveProduct } from './test-support/products.js'
import { commitOperation } from './test-support/schoolwork.js'
import { purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('OP-33 與 OP-34 商品', () => {
  const db = useTestDatabase()

  test('新建與改價推進版本，同值成立，版本衝突帶完整商品值', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    const create = saveProduct(classId, { icon: '☆', description: '測試說明' })
    const created = await commitOperation(client, create)
    expect(created.changes).toEqual([{
      entity: 'product', key: { product_id: create.payload.product_id }, prev_rev: 0, rev: 1,
      last_op_id: create.op_id, prev_value: null, value: {
        name: '測試商品', icon: '☆', price: 3, price_unit: 'point', stock: 3,
        initial_stock: 3, description: '測試說明', disabled: false,
      },
    }])
    const fields = { ...create.payload, price: 5 }
    const changed = await commitOperation(client, saveProduct(classId, fields, { rev: 1 }))
    const noop = await commitOperation(client, saveProduct(classId, fields, { rev: 2 }))
    expect(noop).toMatchObject({ result: { noop: true }, changes: [{ rev: 2, last_op_id: changed.op_id }] })
    for (const rev of [0, 1]) {
      const conflict = await submit(client, saveProduct(classId, fields, { rev }))
      expect(conflict).toMatchObject({ code: 'STALE_STATE', current: { rev: 2, value: changed.changes[0].value } })
    }
    expect(await submit(client, saveProduct(classId, {}, { rev: 3 })))
      .toMatchObject({ code: 'STALE_STATE', current: { rev: 0 } })
  })

  test('長編號新建先驗版本，匯入的同形編號可存檔與停用', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    const productId = 'a'.repeat(64)
    expect(await submit(client, saveProduct(classId, { product_id: productId }, { rev: 3 })))
      .toMatchObject({ code: 'STALE_STATE', current: { rev: 0 } })
    expect(await submit(client, saveProduct(classId, { product_id: productId }))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(await submit(client, retireProduct(classId, productId, 1))).toMatchObject({ code: 'NOT_FOUND' })
    await client.query(`
      INSERT INTO ppt.products (class_id, product_id, name, price, price_unit)
      VALUES ($1, $2, '匯入商品', 3, 'point')
    `, [classId, productId])
    const updated = await commitOperation(client, saveProduct(classId, { product_id: productId }, { rev: 1 }))
    expect(updated.changes[0]).toMatchObject({ prev_value: { stock: null }, value: { stock: 3 } })
    const retired = await commitOperation(client, retireProduct(classId, productId, 2))
    expect(retired.changes[0]).toMatchObject({ value: { disabled: true }, rev: 3 })
  })

  test('購買推進商品版本，可用購買操作的 after_op 存檔', async () => {
    const { client } = db()
    const target = await addClass(client)
    const created = saveProduct(target.classId)
    await commitOperation(client, created)
    const itemId = await buyItem(client, target, created.payload.product_id)
    const { rows: [{ last_op_id: opId }] } = await client.query(
      'SELECT last_op_id FROM ppt.inventory_items WHERE class_id = $1 AND item_id = $2', [target.classId, itemId],
    )
    const fields = { ...created.payload, price: 2, stock: 2 }
    expect(await submit(client, saveProduct(target.classId, fields, { rev: 1 })))
      .toMatchObject({ code: 'STALE_STATE', current: { rev: 2, value: { stock: 2 } } })
    const changed = await commitOperation(client, saveProduct(target.classId, fields, { after_op: opId }))
    expect(changed.changes[0]).toMatchObject({ prev_rev: 2, rev: 3, value: { price: 2 } })
  })

  test('停用不改庫存或物品，重複停用同值，存檔後可再買', async () => {
    const { client } = db()
    const target = await addClass(client)
    const created = saveProduct(target.classId)
    await commitOperation(client, created)
    const productId = created.payload.product_id
    const itemId = await buyItem(client, target, productId)
    const retired = await commitOperation(client, retireProduct(target.classId, productId, 2))
    expect(retired.changes[0]).toMatchObject({ rev: 3, value: { stock: 2, disabled: true } })
    expect(await submit(client, purchase({ ...target, productId }))).toMatchObject({ code: 'ENTITY_INACTIVE' })
    await commitOperation(client, useItem(target.classId, itemId))
    const noop = await commitOperation(client, retireProduct(target.classId, productId, 3))
    expect(noop).toMatchObject({ result: { noop: true }, changes: [{ rev: 3 }] })
    const enabled = await commitOperation(client, saveProduct(target.classId, { ...created.payload, stock: 2 }, { rev: 3 }))
    expect(enabled).toMatchObject({ result: { noop: false }, changes: [{ rev: 4, value: { disabled: false } }] })
    await commitOperation(client, purchase({ ...target, productId }))
  })

  test('拒絕價格與庫存越界、小數、錯單位、錯名稱和錯鍵', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    for (const fields of [{ price: -1 }, { price: 1.5 }, { price: 100001 }, { stock: -1 }, { stock: 1e30 },
      { initial_stock: 100001 }, { price_unit: 'other' }, { name: '' }, { name: '字'.repeat(101) },
      { initial_stock: undefined }, { unknown: true }, { icon: null }, { description: 1 }]) {
      expect(await submit(client, saveProduct(classId, fields))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })
})
