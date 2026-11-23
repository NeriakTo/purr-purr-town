import { listOperationsInTransaction, runStorageTransaction, serializeEntityKey } from '../storage/queue-storage.js'
import { listConfirmedRowsInTransaction } from './confirmed-data.js'

function rowId(entity, entityKey) {
  return JSON.stringify([entity, entityKey])
}

// 預估函式以唯讀方式使用操作和列值，並回傳要合併的欄位。
export function projectRows(confirmedRows, operations, projectors) {
  const rows = new Map()
  const unprojectedOperations = []
  for (const row of confirmedRows) {
    rows.set(rowId(row.entity, row.entityKey), { ...row, pendingOperations: [] })
  }

  const readValue = (entity, key) => rows.get(rowId(entity, serializeEntityKey(key)))?.value
  for (const operation of operations) {
    const { op_id, status, type } = operation
    const marker = { op_id, status }
    const changes = Object.hasOwn(projectors, type) ? projectors[type](operation, readValue) : null
    if (changes === null) {
      unprojectedOperations.push(marker)
      continue
    }
    for (const { entity, key, value } of changes) {
      const entityKey = serializeEntityKey(key)
      const id = rowId(entity, entityKey)
      const row = rows.get(id) ?? { entity, key, entityKey, rev: null, pendingOperations: [] }
      row.value = { ...row.value, ...value }
      if (row.pendingOperations.at(-1) !== marker) row.pendingOperations.push(marker)
      rows.set(id, row)
    }
  }

  return { rows: [...rows.values()], unprojectedOperations }
}

export function readProjectedRows(db, scope, projectors) {
  return runStorageTransaction(db, ['confirmedRows', 'queuedOps'], 'readonly', async tx => {
    const [rows, operations] = await Promise.all([
      listConfirmedRowsInTransaction(tx, scope),
      listOperationsInTransaction(tx, scope),
    ])
    return projectRows(rows, operations, projectors)
  })
}
