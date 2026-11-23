import { splitSubmitBatches } from '../net/batches.js'
import { decideReceipts } from '../queue/receipts.js'
import {
  getLocalLogin, getLocalLoginInTransaction, runStorageTransaction,
} from '../storage/queue-storage.js'
import {
  markSending, readAccountOperations, recoverOperations, requireAccount, resumePaused, writeReceipts,
} from './sender-storage.js'

export const SENDER_LOCK_NAME = 'ppt-revamp-sender'
export const DEFAULT_IDLE_POLL_MS = 3000

const SUBMIT_PATH = '/api/v2/ops'
const SNAPSHOT_STORES = ['localLogin', 'queuedOps']
const defaultClock = {
  now: Date.now,
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: timer => globalThis.clearTimeout(timer),
}

function groupByClass(operations) {
  const classes = new Map()
  for (const operation of operations) {
    if (!classes.has(operation.classId)) classes.set(operation.classId, [])
    classes.get(operation.classId).push(operation)
  }
  for (const items of classes.values()) items.sort((left, right) => left.client_seq - right.client_seq)
  return classes
}

function readSnapshot(db) {
  return runStorageTransaction(db, SNAPSHOT_STORES, 'readonly', async tx => {
    const login = await getLocalLoginInTransaction(tx)
    const operations = login ? await readAccountOperations(tx, login.accountId) : []
    return { login, operations }
  })
}

function notify(callback, value) {
  try {
    // 通知是交易完成後的副作用，呼叫端出錯不能讓已提交的回應再寫一次。
    void Promise.resolve(callback?.(value)).catch(() => {})
  } catch {
    // 通知失敗留給呼叫端自行處理。
  }
}

function classState(head, now, waitStatus) {
  const { classId, op_id: opId, status, nextAttemptAt } = head
  const base = { classId, opId }
  if (status === 'paused') return { ...base, status: 'paused' }
  if (status === 'cancelling') return { ...base, status: 'waiting_cancel' }
  if (waitStatus) return { ...base, status: waitStatus }
  if (status === 'sending') return { ...base, status: 'sending' }
  if (nextAttemptAt > now) return { ...base, status: 'waiting_retry', nextAttemptAt }
  return { ...base, status: 'queued' }
}

const accountChanged = error => error?.code === 'ACCOUNT_MISMATCH' || error?.code === 'LOGIN_REQUIRED'

export function createSender({
  db, transport, relayPassStore, locks, receiptApplier, clock = defaultClock,
  idlePollMs = DEFAULT_IDLE_POLL_MS, onReadNeeded, onStateChange,
}) {
  let state = { hasLock: false, status: 'stopped', accountId: null, classes: [] }
  let active
  let generation = 0
  let interruptSleep

  function getState() {
    return { ...state, classes: state.classes.map(item => ({ ...item })) }
  }

  function publish(next) {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    notify(onStateChange, getState())
  }

  function publishClass(next) {
    publish({ ...state, classes: state.classes.map(item => item.classId === next.classId ? next : item) })
  }

  function wake() {
    generation++
    interruptSleep?.()
  }

  function sleep(delay, signal, roundGeneration) {
    if (signal.aborted || generation !== roundGeneration) return
    return new Promise(resolve => {
      const timer = clock.setTimeout(finish, delay)
      function finish() {
        interruptSleep = undefined
        clock.clearTimeout(timer)
        resolve()
      }
      interruptSleep = finish
    })
  }

  function waitStatus(wait, login, relayPass) {
    if (!wait || wait.generation !== generation) return undefined
    if (wait.status === 'waiting_login') return wait.value === login.token ? wait.status : undefined
    return wait.value === relayPass ? wait.status : undefined
  }

  function recordWaits(waits, actions, login, relayPass, sendGeneration) {
    for (const action of actions) {
      const forLogin = action.type === 'wait_for_login'
      const key = action.level === 'receipt' ? action.op_id : null
      waits.set(key, {
        status: forLogin ? 'waiting_login' : 'waiting_relay_pass',
        value: forLogin ? login.token : relayPass,
        generation: sendGeneration,
      })
    }
  }

  async function processClass({ scope, head, items, view, relayPass, waits, signal, roundGeneration }) {
    if (view.status === 'sending') {
      const recovered = await recoverOperations(db, scope.accountId, scope.classId, clock.now)
      if (!recovered) publishClass({ ...view, status: 'error', reason: 'invalid_transition' })
      return recovered
    }
    if (view.status !== 'queued') return false
    const candidates = []
    for (const operation of items) {
      if (operation.status !== 'queued' || operation.nextAttemptAt > clock.now() || waits.has(operation.op_id)) break
      if (candidates.length && operation.sendIndividually) break
      candidates.push(operation)
      if (operation.sendIndividually) break
    }
    const { bodies, blocked } = splitSubmitBatches({ classId: scope.classId, operations: candidates, relayPass })
    const [bodyText] = bodies
    if (!bodyText) {
      if (blocked) publishClass({ ...view, status: 'blocked', reason: blocked.reason })
      return false
    }

    const ids = JSON.parse(bodyText).ops.map(op => op.op_id)
    const marked = await markSending(db, scope, ids, clock.now, signal)
    if (!marked) return true
    if (marked.invalidOpId) {
      publishClass({ ...view, status: 'error', opId: marked.invalidOpId, reason: 'invalid_transition' })
      return false
    }
    if (signal.aborted) return false

    try {
      const login = await getLocalLogin(db)
      requireAccount(login, scope.accountId)
      if (!login.token || signal.aborted) return true
      publishClass({ classId: scope.classId, status: 'sending', opId: head.op_id })
      if (signal.aborted) return false
      const result = await transport.send({ path: SUBMIT_PATH, token: login.token, bodyText })
      if (signal.aborted) return false

      const { items: sent } = marked
      const decision = decideReceipts({ endpoint: 'submit', items: sent, single: sent.length === 1, result })
      const written = await writeReceipts(db, scope, decision, receiptApplier, clock.now)
      recordWaits(waits, written.waiting, login, relayPass, roundGeneration)
      if (written.invalidIds.length) {
        publishClass({ ...view, status: 'error', opId: written.invalidIds[0], reason: 'invalid_transition' })
      }
      if (written.read) notify(onReadNeeded, written.read)
    } catch (error) {
      if (accountChanged(error)) throw error
      // 寫回失敗時仍是送出中，下一輪依已記下的嘗試次數退避。
      publishClass({ ...view, status: 'error', reason: 'send_interrupted' })
    }
    return true
  }

  async function holdLock(signal) {
    let takenOverAccount
    const accountWaits = new Map()
    publish({ hasLock: true, status: 'running', accountId: null, classes: [] })
    while (!signal.aborted) {
      const roundGeneration = generation
      let deadline = clock.now() + idlePollMs
      try {
        let { login, operations } = await readSnapshot(db)
        if (signal.aborted) break
        const accountId = login?.accountId ?? null
        if (accountId !== takenOverAccount) {
          if (accountId !== null) {
            const recovered = await recoverOperations(db, accountId)
            if (!recovered) {
              publish({ hasLock: true, status: 'error', accountId, classes: [], reason: 'invalid_transition' })
              await sleep(idlePollMs, signal, roundGeneration)
              continue
            }
            const snapshot = await readSnapshot(db)
            login = snapshot.login
            operations = snapshot.operations
            requireAccount(login, accountId)
          }
          takenOverAccount = accountId
        }

        const classes = groupByClass(operations)
        const waits = accountWaits.get(accountId) ?? new Map()
        if (accountId !== null) accountWaits.set(accountId, waits)
        const relayPass = login?.token && classes.size ? await relayPassStore.read() : undefined
        if (signal.aborted) break
        const ids = new Set(operations.map(operation => operation.op_id))
        for (const [id, wait] of waits) {
          if ((id !== null && !ids.has(id)) || (login?.token && !waitStatus(wait, login, relayPass))) waits.delete(id)
        }
        const status = !login ? 'signed_out' : !login.token ? 'waiting_login' : waits.get(null)?.status ?? 'running'
        const views = [...classes.values()].map(([head]) => classState(
          head, clock.now(), status === 'running' ? waits.get(head.op_id)?.status : status,
        ))
        publish({ hasLock: true, status, accountId, classes: views })
        if (status === 'running') {
          let changed = false
          for (const view of views) {
            if (signal.aborted || waits.has(null)) break
            if (view.status === 'waiting_retry') deadline = Math.min(deadline, view.nextAttemptAt)
            const items = classes.get(view.classId)
            const scope = { accountId, classId: view.classId }
            const progress = await processClass({
              scope, head: items[0], items, view, relayPass, waits, signal, roundGeneration,
            })
            changed ||= progress
          }
          if (changed) continue
        }
      } catch (error) {
        if (accountChanged(error)) {
          takenOverAccount = undefined
          continue
        }
        publish({ ...state, status: 'error', reason: 'queue_unavailable' })
        deadline = clock.now() + idlePollMs
      }
      await sleep(Math.max(0, deadline - clock.now()), signal, roundGeneration)
    }
  }

  async function run(request) {
    try {
      const { signal } = request.controller
      if (signal.aborted) return
      await locks.request(SENDER_LOCK_NAME, { mode: 'exclusive', signal }, async lock => {
        if (lock && !signal.aborted) await holdLock(signal)
      })
    } catch {
      if (!request.controller.signal.aborted) {
        publish({ hasLock: false, status: 'error', accountId: null, classes: [], reason: 'lock_failed' })
      }
    } finally {
      if (state.status !== 'error' || request.controller.signal.aborted) {
        publish({ hasLock: false, status: 'stopped', accountId: null, classes: [] })
      }
    }
  }

  function start() {
    if (active) {
      if (active.controller.signal.aborted) active.restart = true
      return
    }
    if (typeof locks?.request !== 'function') throw new Error('送出迴圈需要 Web Locks')
    if (!Array.isArray(receiptApplier?.stores) || typeof receiptApplier.applyReceipt !== 'function' ||
        typeof receiptApplier.observeSubmitSequence !== 'function') {
      throw new Error('送出迴圈需要收據套用介面')
    }
    if (!Number.isFinite(idlePollMs) || idlePollMs <= 0) throw new Error('重看間隔須為正數')
    const request = { controller: new AbortController(), restart: false }
    active = request
    request.done = Promise.resolve().then(() => run(request))
    // 等舊一輪釋放送出權且停止完成，再處理最後一次啟停要求。
    void request.done.then(() => {
      active = undefined
      if (request.restart) start()
    })
    publish({ hasLock: false, status: 'waiting_lock', accountId: null, classes: [] })
  }

  function stop() {
    const request = active
    if (request) {
      request.restart = false
      request.controller.abort()
    }
    interruptSleep?.()
    // 仍持有送出權直到既有連線回傳，以免正常停止時與接手者同時送出。
    return request?.done ?? Promise.resolve()
  }

  async function retryPaused(scope, opId) {
    try {
      const resumed = await resumePaused(db, scope, opId)
      if (resumed) wake()
      return resumed
    } catch (error) {
      if (accountChanged(error)) return false
      throw new Error('無法恢復待送操作')
    }
  }

  return { start, stop, wake, retryPaused, getState }
}
