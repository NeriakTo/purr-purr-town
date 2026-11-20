import { randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'

export function saveProduct(classId, fields = {}, version = { rev: 0 }) {
  return operation(classId, 'product.save', {
    product_id: randomUUID(), name: '測試商品', price: 3, price_unit: 'point', stock: 3, initial_stock: 3, ...fields,
  }, version)
}

export function retireProduct(classId, productId, rev) {
  return operation(classId, 'product.retire', { product_id: productId }, { rev })
}
