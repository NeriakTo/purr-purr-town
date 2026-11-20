import { adjustment } from './operations.js'
import { commitOperation, operation } from './schoolwork.js'
import { purchase } from './shop.js'

export function useItem(classId, itemId) {
  return operation(classId, 'inventory.use', { item_id: itemId })
}

export async function buyItem(client, target, productId, price = 3) {
  await commitOperation(client, adjustment(target, price + 10))
  const op = purchase({ ...target, productId }, price)
  await commitOperation(client, op)
  return op.payload.item_id
}
