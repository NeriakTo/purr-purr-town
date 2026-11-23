import { classifyReceiptSequence, observeSubmitSequence } from '../queue/queue-rules.js'
import {
  getClassStateInTransaction, requestResult, runStorageTransaction, saveClassStateInTransaction,
  serializeEntityKey, StorageError, writeClassDataInTransaction,
} from '../storage/queue-storage.js'

const ROWS_STORE = 'confirmedRows'
export const RECEIPT_APPLY_STORES = Object.freeze(['localLogin', 'classState', ROWS_STORE])

function requireReceiptStores(tx) {
  for (const store of RECEIPT_APPLY_STORES) {
    if (!tx.objectStoreNames.contains(store)) {
      throw new StorageError('TRANSACTION_SCOPE_MISMATCH', `收據套用交易須涵蓋 ${store} 儲存區`)
    }
  }
}

function confirmedRow({ accountId, classId }, { entity, key, rev, value }) {
  return { accountId, classId, entity, entityKey: serializeEntityKey(key), key, rev, value }
}

function getConfirmedRow(store, { accountId, classId, entity, entityKey }) {
  return requestResult(store.get([accountId, classId, entity, entityKey]))
}

function copyReceiptMetadata(row, source) {
  if (Object.hasOwn(source, 'basis_rev')) row.basis_rev = source.basis_rev
  if (Object.hasOwn(source, 'last_op_id')) row.last_op_id = source.last_op_id
}

async function applyReceiptChanges(store, scope, changes) {
  for (const change of changes) {
    const row = confirmedRow(scope, change)
    const current = await getConfirmedRow(store, row)
    if (current && !(row.rev > current.rev)) continue

    row.value = change.value === null ? null : { ...current?.value, ...change.value }
    if (current?.incomplete || change.prev_rev !== (current?.rev ?? 0)) row.incomplete = true
    copyReceiptMetadata(row, change)
    await requestResult(store.put(row))
  }
}

async function saveSequences(tx, scope, current, seenSeq, appliedSeq) {
  if (seenSeq !== current.seenSeq || appliedSeq !== current.appliedSeq) {
    await saveClassStateInTransaction(tx, scope, { seenSeq, appliedSeq })
  }
}

export async function applyReceiptInTransaction(tx, scope, receipt) {
  if (receipt.status !== 'committed') return { sequence: 'ignored' }

  return writeClassDataInTransaction(tx, scope, async () => {
    requireReceiptStores(tx)
    await applyReceiptChanges(tx.objectStore(ROWS_STORE), scope, receipt.changes)
    const current = await getClassStateInTransaction(tx, scope)
    const decision = classifyReceiptSequence(receipt.class_seq, {
      maxSeenSeq: current.seenSeq, appliedSeq: current.appliedSeq,
    })
    const appliedSeq = decision.kind === 'next' ? decision.applyThroughSeq : current.appliedSeq
    await saveSequences(tx, scope, current, decision.maxSeenSeq, appliedSeq)
    return decision.kind === 'gap'
      ? { sequence: decision.kind, readSinceSeq: decision.readSinceSeq }
      : { sequence: decision.kind }
  })
}

export function observeSubmitSequenceInTransaction(tx, scope, classSeq) {
  return writeClassDataInTransaction(tx, scope, async () => {
    requireReceiptStores(tx)
    const current = await getClassStateInTransaction(tx, scope)
    const { maxSeenSeq } = observeSubmitSequence(classSeq, {
      maxSeenSeq: current.seenSeq, appliedSeq: current.appliedSeq,
    })
    await saveSequences(tx, scope, current, maxSeenSeq, current.appliedSeq)
  })
}

export function applyReadRowsInTransaction(tx, scope, rows) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const store = tx.objectStore(ROWS_STORE)
    for (const input of rows) {
      const row = confirmedRow(scope, input)
      const current = await getConfirmedRow(store, row)
      if (!current || row.rev > current.rev) {
        await requestResult(store.put(row))
      } else if (row.rev === current.rev && current.incomplete) {
        copyReceiptMetadata(row, current)
        await requestResult(store.put(row))
      }
    }
  })
}

export function advanceReadSequenceInTransaction(tx, scope, classSeq) {
  return writeClassDataInTransaction(tx, scope, async () => {
    if (!Number.isSafeInteger(classSeq) || classSeq < 0) {
      throw new TypeError('讀取回應的班級序號須為非負安全整數')
    }
    const current = await getClassStateInTransaction(tx, scope)
    await saveSequences(tx, scope, current, Math.max(current.seenSeq, classSeq), Math.max(current.appliedSeq, classSeq))
  })
}

export function listConfirmedRowsInTransaction(tx, { accountId, classId }) {
  const prefix = [accountId, classId]
  // 實體名稱是字串，複合鍵中的陣列界線排在任何實體名稱之後。
  const range = IDBKeyRange.bound(prefix, [...prefix, []], false, true)
  return requestResult(tx.objectStore(ROWS_STORE).getAll(range))
}

export function listConfirmedRows(db, scope) {
  return runStorageTransaction(db, ROWS_STORE, 'readonly', tx => listConfirmedRowsInTransaction(tx, scope))
}

export function listConfirmedRowsByEntityInTransaction(tx, { accountId, classId }, entity) {
  const index = tx.objectStore(ROWS_STORE).index('byClassEntity')
  return requestResult(index.getAll([accountId, classId, entity]))
}

export function listConfirmedRowsByEntity(db, scope, entity) {
  return runStorageTransaction(db, ROWS_STORE, 'readonly', tx => listConfirmedRowsByEntityInTransaction(tx, scope, entity))
}
