import { expect } from 'vitest'
import { classSnapshot } from './checks.js'
import { adjustment, submit } from './operations.js'
import { saveProduct } from './products.js'
import { commitOperation } from './schoolwork.js'
import { purchase } from './shop.js'

export async function buyForUndo(client, target) {
  const product = saveProduct(target.classId)
  await commitOperation(client, product)
  await commitOperation(client, adjustment(target, 100))
  const operation = purchase({ ...target, productId: product.payload.product_id })
  const receipt = await commitOperation(client, operation)
  return {
    ...target, productId: product.payload.product_id, itemId: operation.payload.item_id,
    purchase: receipt, rootId: receipt.result.transactions[0],
  }
}

export async function rejectUndoWithoutChanges(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}
