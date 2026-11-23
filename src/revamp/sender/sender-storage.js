import { retryDelaySeconds, transitionQueueState } from '../queue/queue-rules.js'
import {
  getLocalLoginInTransaction, listOperationsInTransaction, removeOperationInTransaction,
  runStorageTransaction, updateOperationInTransaction,
} from '../storage/queue-storage.js'

const QUEUE_STORE = 'queuedOps'
export const QUEUE_WRITE_STORES = ['localLogin', QUEUE_STORE]
const SETTLE_STORES = [...QUEUE_WRITE_STORES, 'queuedTargets', 'needsAttention']

function readRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
}

export function requireAccount(login, accountId) {
  if (login?.accountId === accountId) return
  const code = login ? 'ACCOUNT_MISMATCH' : 'LOGIN_REQUIRED'
  throw Object.assign(new Error('本機登入帳號已變更'), { code })
}

export function readAccountOperations(tx, accountId) {
  return readRequest(tx.objectStore(QUEUE_STORE).index('byAccount').getAll(accountId))
}

export function transition(operation, event) {
  const result = transitionQueueState(operation.status, event)
  return result.ok ? result.state : undefined
}

export function recoverOperations(db, accountId, classId, now) {
  return runStorageTransaction(db, QUEUE_WRITE_STORES, 'readwrite', async tx => {
    requireAccount(await getLocalLoginInTransaction(tx), accountId)
    const operations = classId === undefined
      ? await readAccountOperations(tx, accountId)
      : await listOperationsInTransaction(tx, { accountId, classId })
    for (const operation of operations) {
      if (operation.status !== 'sending') continue
      const status = transition(operation, 'takeover')
      if (!status) return false
      const scope = { accountId, classId: operation.classId }
      const patch = { status }
      if (classId !== undefined) {
        patch.nextAttemptAt = now() + retryDelaySeconds(operation.attempts ?? 0) * 1000
        patch.lastCode = 'SEND_INTERRUPTED'
      }
      await updateOperationInTransaction(tx, scope, operation.op_id, patch)
    }
    return true
  })
}

export function markSending(db, scope, ids, now, signal) {
  return runStorageTransaction(db, QUEUE_WRITE_STORES, 'readwrite', async tx => {
    const login = await getLocalLoginInTransaction(tx)
    requireAccount(login, scope.accountId)
    if (!login.token || signal.aborted) return null
    const operations = await listOperationsInTransaction(tx, scope)
    // 另一分頁可能在分批的同時移出項目或要求放棄，須重核要送的是原來的前綴。
    if (ids.some((id, index) => {
      const operation = operations[index]
      return operation?.op_id !== id || operation.status !== 'queued' ||
        (operation.nextAttemptAt ?? 0) > now() || (ids.length > 1 && operation.sendIndividually)
    })) return null
    const items = []
    for (const operation of operations.slice(0, ids.length)) {
      const state = transition(operation, 'send')
      if (!state) return { invalidOpId: operation.op_id }
      items.push({
        op_id: operation.op_id,
        state,
        internalErrors: operation.consecutiveInternalErrors ?? 0,
        attempts: (operation.attempts ?? 0) + 1,
      })
    }
    for (const item of items) {
      const updated = await updateOperationInTransaction(tx, scope, item.op_id, {
        status: item.state, attempts: item.attempts,
      })
      if (!updated) throw new Error('送出前待送操作已變更')
    }
    return { items }
  })
}

const removalActions = new Set(['remove', 'needs_attention', 'remove_and_read'])
const events = {
  retry: 'retry',
  pause: 'pause',
  wait_for_login: 'retry',
  wait_for_relay_pass: 'retry',
  retry_single: 'retry',
  start_cancel: 'report_unsaved',
  undecided: 'retry',
  keep: 'retry',
  keep_cancelling: 'retry',
}

function retryPatch(operation, action, status, now) {
  const patch = {
    status, nextAttemptAt: 0, lastCode: action.code, consecutiveInternalErrors: action.internalErrors,
  }
  switch (action.type) {
    case 'retry':
      patch.nextAttemptAt = now() + action.waitSeconds * 1000
      break
    case 'retry_single':
      patch.sendIndividually = true
      break
    case 'undecided':
    case 'keep':
    case 'keep_cancelling':
      return {
        status,
        nextAttemptAt: now() + retryDelaySeconds(operation.attempts ?? 0) * 1000,
        lastCode: action.reason ?? action.type,
      }
  }
  return patch
}

export function writeReceipts(db, scope, decision, applier, now) {
  const stores = [...new Set([...SETTLE_STORES, ...applier.stores])]
  return runStorageTransaction(db, stores, 'readwrite', async tx => {
    requireAccount(await getLocalLoginInTransaction(tx), scope.accountId)
    const operations = new Map((await listOperationsInTransaction(tx, scope)).map(op => [op.op_id, op]))
    const waiting = []
    const invalidIds = []
    let read
    for (const action of decision.actions) {
      const operation = operations.get(action.op_id)
      if (!operation) continue
      const removes = removalActions.has(action.type)
      if (!removes && operation.status === 'cancelling') continue
      const status = transition(operation, removes ? 'settled' : events[action.type])
      if (!status) {
        invalidIds.push(action.op_id)
        continue
      }
      if (!removes) {
        const updated = await updateOperationInTransaction(tx, scope, action.op_id, retryPatch(operation, action, status, now))
        if (updated && (action.type === 'wait_for_login' || action.type === 'wait_for_relay_pass')) waiting.push(action)
        continue
      }
      let attention
      if (action.type === 'remove') {
        const applied = await applier.applyReceipt(tx, scope, action.receipt)
        if (applied.sequence === 'gap') {
          read = { ...scope, readSinceSeq: Math.min(read?.readSinceSeq ?? Infinity, applied.readSinceSeq) }
        }
      }
      if (action.type === 'needs_attention') {
        const { code, programmerError, level, via, receipt, current } = action
        attention = { reason: code, code, programmerError, level, via, receipt, movedAt: now() }
        if (current !== undefined) attention.current = current
      }
      const removed = await removeOperationInTransaction(tx, scope, action.op_id, attention)
      if (removed && action.type === 'remove_and_read') read ??= { ...scope }
    }
    if (decision.submitClassSeq !== undefined) {
      await applier.observeSubmitSequence(tx, scope, decision.submitClassSeq)
    }
    return { waiting, invalidIds, read }
  })
}

export function resumePaused(db, scope, opId) {
  return runStorageTransaction(db, QUEUE_WRITE_STORES, 'readwrite', async tx => {
    requireAccount(await getLocalLoginInTransaction(tx), scope.accountId)
    const current = await readRequest(tx.objectStore(QUEUE_STORE).get(opId))
    if (current?.accountId !== scope.accountId || current.classId !== scope.classId || current.status !== 'paused') return false
    const status = transition(current, 'resume')
    if (!status) return false
    const resumed = await updateOperationInTransaction(tx, scope, opId, {
      status, attempts: 0, consecutiveInternalErrors: 0, nextAttemptAt: 0,
    })
    return resumed !== undefined
  })
}
