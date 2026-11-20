import { randomUUID } from 'node:crypto'

export async function addProduct(client, classId, { price = 3, unit = 'point', stock = 1, disabled = false } = {}) {
  const productId = randomUUID()
  await client.query(`
    INSERT INTO ppt.products (class_id, product_id, name, icon, price, price_unit, stock, initial_stock, disabled)
    VALUES ($1,$2,'試用道具','☆',$3,$4,$5,$5,$6)
  `, [classId, productId, price, unit, stock, disabled])
  return productId
}

export function purchase({ classId, studentId, productId }, price = 3) {
  return {
    op_id: randomUUID(),
    class_id: classId,
    type: 'shop.purchase',
    payload: { student_id: studentId, product_id: productId, item_id: randomUUID(), expect_price_points: price },
  }
}
