import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  createOperations, deleteLocalLogin, getClassStateInTransaction, listNeedsAttentionInTransaction, listOperations,
  openQueueDatabase, removeOperation, runStorageTransaction, saveClassStateInTransaction, saveLocalLogin, updateOperation,
} from '../storage/queue-storage.js'
import { splitSubmitBatches } from '../net/batches.js'
import { createMemoryRelayPassStore } from '../net/transport.js'
import committed from '../../../docs/revamp/frontend-queue/samples/submit-committed.json'
import rejected from '../../../docs/revamp/frontend-queue/samples/submit-rejected.json'
import { createSender, DEFAULT_IDLE_POLL_MS, SENDER_LOCK_NAME } from './sender.js'

const scope = { accountId: '測試帳號甲', classId: '測試班甲' }
const otherClass = { ...scope, classId: '測試班乙' }
const otherAccount = { ...scope, accountId: '測試帳號乙' }
const token = 'a'.repeat(64)
const newToken = 'b'.repeat(64)
const pass = '測試用假通行碼'
const http = body => ({ kind: 'http', via: 'direct', status: 200, bodyText: JSON.stringify(body) })
const request = (code, fields) => http({ error: { code, ...fields } })
const retry = (op_id, code) => ({ op_id, status: 'retry', code })
const submit = (...receipts) => http({ ...committed, receipts })
const saved = op_id => ({ ...committed.receipts[0], op_id })
const denied = (op_id, fields) => ({ ...rejected.receipts[0], op_id, ...fields })
const lost = { kind: 'lost', via: 'direct', reason: 'timeout' }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fakeLocks() {
  let holder
  const pending = []
  function grant() {
    if (holder || !pending.length) return
    const entry = pending.shift()
    entry.signal.removeEventListener('abort', entry.abort)
    holder = entry
    Promise.resolve().then(() => entry.callback({ name: SENDER_LOCK_NAME })).then(
      entry.done.resolve, entry.done.reject,
    ).finally(() => {
      if (holder === entry) holder = undefined
      grant()
    })
  }
  return {
    request(name, { mode, signal }, callback) {
      expect(name).toBe(SENDER_LOCK_NAME)
      expect(mode).toBe('exclusive')
      const done = deferred()
      function abort() {
        pending.splice(pending.indexOf(entry), 1)
        done.reject(new DOMException('已停止', 'AbortError'))
      }
      const entry = { signal, callback, done, abort }
      signal.addEventListener('abort', abort, { once: true })
      pending.push(entry)
      grant()
      return done.promise
    },
    disappear() {
      holder = undefined
      grant()
    },
  }
}

function fakeClock() {
  let time = Date.UTC(2026, 0, 1)
  const timers = new Map()
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const key = Symbol()
      timers.set(key, { callback, at: time + delay })
      return key
    },
    clearTimeout(key) { timers.delete(key) },
    advance(ms) {
      time += ms
      for (const [key, { at, callback }] of timers) {
        if (at > time) continue
        timers.delete(key)
        callback()
      }
    },
    next: () => Math.min(...Array.from(timers.values(), timer => timer.at)),
  }
}

async function until(check) {
  for (let turn = 0; turn < 2000; turn++) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('迴圈未到達預期進度')
}

let db
let peer
let locks
let clock
let sequence
let senders

const login = (accountId = scope.accountId, value = token) => saveLocalLogin(peer, { accountId, token: value })

beforeEach(async () => {
  const factory = new IDBFactory()
  db = await openQueueDatabase({ factory })
  peer = await openQueueDatabase({ factory })
  locks = fakeLocks()
  clock = fakeClock()
  sequence = 0
  senders = []
  await login()
})

afterEach(async () => {
  const stopping = senders.map(({ sender }) => sender.stop())
  for (const { calls } of senders) {
    for (const call of calls) call.response.resolve(lost)
  }
  await Promise.all(stopping)
  db.close()
  peer.close()
})

function add(count = 1, { to = scope, connection = db, payload = { demo: '測試' } } = {}) {
  return createOperations(connection, to, Array.from({ length: count }, () => ({ type: 'demo', payload })), {
    now: clock.now,
    randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0'),
  })
}

function setup({ connection = db, ...options } = {}) {
  const calls = []
  const onStateChange = vi.fn()
  const onReadNeeded = vi.fn()
  const relayPassStore = createMemoryRelayPassStore(pass)
  const receiptApplier = {
    stores: ['localLogin', 'classState'],
    applyReceipt: vi.fn(async () => ({ sequence: 'next' })),
    observeSubmitSequence: vi.fn(async () => {}),
  }
  const sender = createSender({
    db: connection, locks, clock, relayPassStore, receiptApplier, onStateChange, onReadNeeded,
    transport: { send(input) {
      const body = JSON.parse(input.bodyText)
      const response = deferred()
      calls.push({ ...input, ids: body.ops.map(op => op.op_id), response })
      return response.promise
    } },
    ...options,
  })
  const fixture = {
    sender, calls, onStateChange, onReadNeeded, relayPassStore, receiptApplier,
    call: index => until(() => calls[index]),
    state: (status, classId = scope.classId) => until(() =>
      sender.getState().classes.find(item => item.classId === classId && item.status === status)),
  }
  senders.push(fixture)
  return fixture
}

const operations = (to = scope) => listOperations(peer, to)
const makeSingle = operation => updateOperation(peer, scope, operation.op_id, { sendIndividually: true })
const ready = () => until(() => Number.isFinite(clock.next()))
async function advance(ms) {
  await ready()
  clock.advance(ms)
}
const attention = () => runStorageTransaction(peer, 'needsAttention', 'readonly', tx =>
  listNeedsAttentionInTransaction(tx, scope))

it('兩個分頁只有持鎖者送出，停止後交棒', async () => {
  const [op] = await add()
  const first = setup()
  const second = setup({ connection: peer })
  first.sender.start()
  second.sender.start()
  const call = await first.call(0)
  expect(call.path).toBe('/api/v2/ops')
  expect(second.sender.getState().hasLock).toBe(false)
  expect(second.calls).toHaveLength(0)
  const stopped = first.sender.stop()
  call.response.resolve(lost)
  await stopped
  expect((await second.call(0)).ids).toEqual([op.op_id])
})

it('停止期間多次開始，等在途請求結束後只接手一次', async () => {
  const [head] = await add()
  const requestLock = vi.spyOn(locks, 'request')
  const f = setup()
  f.sender.start()
  const first = await f.call(0)

  const stopped = f.sender.stop()
  f.sender.start()
  f.sender.start()
  await new Promise(resolve => setImmediate(resolve))
  expect(requestLock).toHaveBeenCalledTimes(1)
  expect(f.calls).toHaveLength(1)
  expect(f.sender.getState().hasLock).toBe(true)

  first.response.resolve(lost)
  await stopped
  await until(() => f.calls.length > 1 || f.sender.getState().status === 'stopped')
  expect(f.calls.map(call => call.ids)).toEqual([[head.op_id], [head.op_id]])
  expect(f.sender.getState()).toMatchObject({ hasLock: true, status: 'running' })
  f.calls[1].response.resolve(submit(saved(head.op_id)))
  await ready()
  expect(await operations()).toEqual([])
  expect(requestLock).toHaveBeenCalledTimes(2)
})

it('停止期間排定的開始可由下一次停止取消', async () => {
  const [head] = await add()
  const requestLock = vi.spyOn(locks, 'request')
  const f = setup()
  f.sender.start()
  const first = await f.call(0)

  const stopped = f.sender.stop()
  f.sender.start()
  const cancelled = f.sender.stop()
  first.response.resolve(lost)
  await Promise.all([stopped, cancelled])
  await new Promise(resolve => setImmediate(resolve))

  expect(f.sender.getState()).toMatchObject({ hasLock: false, status: 'stopped' })
  expect(requestLock).toHaveBeenCalledTimes(1)
  expect(f.calls.map(call => call.ids)).toEqual([[head.op_id]])
  expect(await operations()).toMatchObject([{ op_id: head.op_id }])
})

it('持鎖分頁消失後先重設所有本帳號班級再同編號重送', async () => {
  const [head] = await add()
  await makeSingle(head)
  const [later] = await add()
  const [cancelling, inherited] = await add(2, { to: otherClass })
  await updateOperation(peer, otherClass, cancelling.op_id, { status: 'cancelling' })
  const first = setup()
  first.sender.start()
  const call = await first.call(0)
  expect((await operations())[0].status).toBe('sending')
  await updateOperation(peer, otherClass, inherited.op_id, { status: 'sending' })
  void first.sender.stop()
  locks.disappear()
  const second = setup({ connection: peer })
  second.sender.start()
  await until(() => second.calls.length || Number.isFinite(clock.next()))
  expect(second.calls).toHaveLength(1)
  const [retried] = second.calls
  expect(retried.ids).toEqual(call.ids)
  expect(retried.ids).toEqual([head.op_id])
  expect(await operations(otherClass)).toMatchObject([{ status: 'cancelling' }, { status: 'queued' }])
  retried.response.resolve(submit(saved(head.op_id)))
  expect((await second.call(1)).ids).toEqual([later.op_id])
})

it('班級最前筆退避時後兩筆不能越過它', async () => {
  const [head, second, third] = await add(3)
  const f = setup()
  f.sender.start()
  const first = await f.call(0)
  first.response.resolve(submit(retry(head.op_id, 'SERVER_BUSY'), retry(second.op_id, 'NOT_PROCESSED'),
    retry(third.op_id, 'NOT_PROCESSED')))
  expect((await f.state('waiting_retry')).opId).toBe(head.op_id)
  await updateOperation(peer, scope, second.op_id, { nextAttemptAt: 0 })
  await updateOperation(peer, scope, third.op_id, { nextAttemptAt: 0 })
  f.sender.wake()
  await until(() => f.calls.length > 1 || Number.isFinite(clock.next()))
  expect(f.calls).toHaveLength(1)
  await advance(2000)
  expect((await f.call(1)).ids).toEqual(first.ids)
})

it('暫時結果保留操作，第五次內部錯誤暫停，老師可以再試一次', async () => {
  const [head] = await add()
  await makeSingle(head)
  await add()
  const f = setup()
  f.sender.start()
  const results = [lost, request('SERVER_BUSY'), ...Array.from({ length: 5 }, () => request('INTERNAL_ERROR'))]
  for (const [index, result] of results.entries()) {
    const call = await f.call(index)
    expect(call.ids).toEqual([head.op_id])
    call.response.resolve(result)
    if (index === results.length - 1) break
    const waiting = await f.state('waiting_retry')
    expect((await operations())[0]).toMatchObject({ op_id: head.op_id, status: 'queued' })
    await advance(waiting.nextAttemptAt - clock.now())
  }
  await f.state('paused')
  expect(await operations()).toMatchObject([{ status: 'paused', consecutiveInternalErrors: 5 }, { status: 'queued' }])
  await advance(600_000)
  await ready()
  expect(f.calls).toHaveLength(7)
  expect(await f.sender.retryPaused(scope, head.op_id)).toBe(true)
  expect((await f.call(7)).ids).toEqual([head.op_id])
  expect((await operations())[0]).toMatchObject({ attempts: 1, consecutiveInternalErrors: 0 })
})

it('套用與移出同交易，套用丟錯後回滾並退避重送', async () => {
  const [head] = await add()
  await makeSingle(head)
  const [later] = await add()
  const f = setup()
  let failedTransaction
  let afterRollback
  f.onStateChange.mockImplementation(state => {
    if (state.classes[0]?.reason === 'send_interrupted') afterRollback = operations()
  })
  f.receiptApplier.applyReceipt.mockImplementationOnce(async (tx, to) => {
    failedTransaction = tx
    await saveClassStateInTransaction(tx, to, { seenSeq: 90 })
    throw new Error('測試套用失敗')
  })
  f.sender.start()
  const first = await f.call(0)
  first.response.resolve(submit(saved(head.op_id)))
  const waiting = await f.state('waiting_retry')
  expect((await afterRollback)[0]).toMatchObject({ op_id: head.op_id, status: 'sending', attempts: 1 })
  expect(failedTransaction.mode).toBe('readwrite')
  expect(failedTransaction.objectStoreNames.contains('queuedOps')).toBe(true)
  expect((await operations())[0]).toMatchObject({ op_id: head.op_id, status: 'queued', attempts: 1 })
  const { seenSeq } = await runStorageTransaction(peer, 'classState', 'readonly', tx => getClassStateInTransaction(tx, scope))
  expect(seenSeq).toBe(0)
  await advance(waiting.nextAttemptAt - clock.now())
  const second = await f.call(1)
  expect(second.ids).toEqual(first.ids)
  second.response.resolve(submit(saved(head.op_id)))
  expect((await f.call(2)).ids).toEqual([later.op_id])
  expect(f.receiptApplier.applyReceipt).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: 'readwrite' }), scope, saved(head.op_id),
  )
})

it('拒絕樣本移進需要處理並保留原操作和目前值', async () => {
  const [head] = await add()
  await makeSingle(head)
  const [later] = await add()
  const f = setup()
  f.sender.start()
  const receipt = denied(head.op_id)
  const call = await f.call(0)
  call.response.resolve(http({ ...rejected, receipts: [receipt] }))
  expect((await f.call(1)).ids).toEqual([later.op_id])
  expect(await attention()).toMatchObject([{
    operation: { ...head, status: 'sending', attempts: 1, sendIndividually: true }, reason: 'STALE_STATE', code: 'STALE_STATE',
    current: receipt.current, receipt, programmerError: false, level: 'receipt', via: 'direct',
    movedAt: clock.now(),
  }])
})

it('兩輪之間和送出期間換帳號或登出都停止原帳號', async () => {
  const [head] = await add()
  await makeSingle(head)
  const [later] = await add()
  const reading = deferred()
  const passStore = { read: vi.fn().mockReturnValue(reading.promise) }
  const f = setup({ relayPassStore: passStore })
  f.sender.start()
  await until(() => passStore.read.mock.calls.length)
  await login(otherAccount.accountId)
  reading.resolve(pass)
  await until(() => f.sender.getState().accountId === otherAccount.accountId)
  expect(f.calls).toHaveLength(0)
  expect(await operations()).toMatchObject([{ status: 'queued' }, { status: 'queued' }])
  await login()
  f.sender.wake()
  const first = await f.call(0)
  await login(otherAccount.accountId)
  first.response.resolve(submit(saved(head.op_id)))
  await until(() => f.sender.getState().accountId === otherAccount.accountId)
  expect(f.receiptApplier.applyReceipt).not.toHaveBeenCalled()
  expect(await operations()).toMatchObject([{ op_id: head.op_id, status: 'sending' }, { op_id: later.op_id, status: 'queued' }])
  await login()
  f.sender.wake()
  const second = await f.call(1)
  await deleteLocalLogin(peer)
  second.response.resolve(submit(saved(head.op_id)))
  await until(() => f.sender.getState().status === 'signed_out')
  expect(f.receiptApplier.applyReceipt).not.toHaveBeenCalled()
  expect((await operations())[0].status).toBe('sending')
  expect(f.calls).toHaveLength(2)
})

it('別的帳號留下的送出中項目不送也不重設', async () => {
  await login(otherAccount.accountId)
  const [foreign] = await add(1, { to: otherAccount })
  const original = await updateOperation(peer, otherAccount, foreign.op_id, { status: 'sending', attempts: 2 })
  await login()
  const [own] = await add()
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  expect(call.ids).toEqual([own.op_id])
  call.response.resolve(submit(saved(own.op_id)))
  await ready()
  expect(f.calls).toHaveLength(1)
  expect(await operations(otherAccount)).toEqual([original])
})

it('標成送出中後換帳號，送出前重讀登入紀錄並攔下請求', async () => {
  const [head] = await add()
  const f = setup()
  const openTransaction = db.transaction.bind(db)
  let switchOnCommit = false
  let switching
  vi.spyOn(db, 'transaction').mockImplementation((...args) => {
    const tx = openTransaction(...args)
    if (switchOnCommit && tx.mode === 'readwrite') {
      switchOnCommit = false
      tx.addEventListener('complete', () => { switching = login(otherAccount.accountId) }, { once: true })
    }
    return tx
  })
  f.onStateChange.mockImplementation(state => {
    if (state.classes[0]?.status === 'queued' && !switching) switchOnCommit = true
  })
  f.sender.start()
  await until(() => f.calls.length || f.sender.getState().accountId === otherAccount.accountId)
  await switching
  expect(f.calls).toHaveLength(0)
  expect((await operations())[0]).toMatchObject({ op_id: head.op_id, status: 'sending' })
})

it('五十一筆先送原樣的五十筆本文，結清後才送最後一筆', async () => {
  const items = await add(51)
  const f = setup()
  f.sender.start()
  const first = await f.call(0)
  const { bodies } = splitSubmitBatches({ classId: scope.classId, operations: items, relayPass: pass })
  expect(first.bodyText).toBe(bodies[0])
  expect(first.ids).toHaveLength(50)
  expect(f.calls).toHaveLength(1)
  first.response.resolve(submit(...first.ids.map(saved)))
  const second = await f.call(1)
  expect(second.ids).toEqual([items[50].op_id])
  expect(second.bodyText).toBe(bodies[1])
})

it('請求信封錯誤拆成單筆，單筆仍錯便保留原碼並等待放棄', async () => {
  const [firstOp, secondOp, thirdOp] = await add(3)
  const [later] = await add()
  const f = setup()
  f.sender.start()
  const initial = await f.call(0)
  initial.response.resolve(request('BAD_ENVELOPE'))
  const first = await f.call(1)
  expect(first.ids).toEqual([firstOp.op_id])
  first.response.resolve(submit(saved(firstOp.op_id)))
  const second = await f.call(2)
  expect(second.ids).toEqual([secondOp.op_id])
  second.response.resolve(submit(saved(secondOp.op_id)))
  const third = await f.call(3)
  expect(third.ids).toEqual([thirdOp.op_id])
  third.response.resolve(request('BAD_ENVELOPE'))
  await f.state('waiting_cancel')
  await advance(600_000)
  await ready()
  expect(f.calls).toHaveLength(4)
  expect(await operations()).toMatchObject([
    { op_id: thirdOp.op_id, status: 'cancelling', lastCode: 'BAD_ENVELOPE' },
    { op_id: later.op_id, status: 'queued' },
  ])
})

it('等登入與通行碼時輪詢不重送，更新並喚醒後同編號送出', async () => {
  const [head] = await add()
  const [other] = await add(1, { to: otherClass })
  const f = setup()
  f.sender.start()
  const first = await f.call(0)
  first.response.resolve(request('AUTH_EXPIRED'))
  await f.state('waiting_login', otherClass.classId)
  await advance(600_000)
  await ready()
  expect(f.calls).toHaveLength(1)
  await login(scope.accountId, newToken)
  f.sender.wake()
  const beforeRelay = await f.call(1)
  expect(beforeRelay.ids).toEqual([head.op_id])
  expect(beforeRelay.token).toBe(newToken)
  beforeRelay.response.resolve({ kind: 'gas_error', via: 'gas', code: 'RELAY_FORBIDDEN' })
  await f.state('waiting_relay_pass', otherClass.classId)
  await advance(600_000)
  await ready()
  expect(f.calls).toHaveLength(2)
  f.relayPassStore.write('更新後的假通行碼')
  f.sender.wake()
  const afterRelay = await f.call(2)
  expect(afterRelay.ids).toEqual([head.op_id])
  afterRelay.response.resolve(submit(saved(head.op_id)))
  expect((await f.call(3)).ids).toEqual([other.op_id])
})

it('不喚醒時重看另一連線寫入的登入權杖，用新權杖同編號重送', async () => {
  const [head] = await add()
  const f = setup()
  f.sender.start()
  const first = await f.call(0)
  expect(first.token).toBe(token)
  first.response.resolve(request('AUTH_EXPIRED'))
  await f.state('waiting_login')
  await ready()

  await login(scope.accountId, newToken)
  await advance(DEFAULT_IDLE_POLL_MS - 1)
  expect(f.calls).toHaveLength(1)
  await advance(1)
  await until(() => f.calls.length > 1 || Number.isFinite(clock.next()))
  expect(f.calls[1]).toMatchObject({ ids: [head.op_id], token: newToken })
})

it('不喚醒時重看新存的通行碼，同編號重送', async () => {
  const [head] = await add()
  const f = setup()
  f.sender.start()
  const first = await f.call(0)
  first.response.resolve({ kind: 'gas_error', via: 'gas', code: 'RELAY_FORBIDDEN' })
  await f.state('waiting_relay_pass')
  await ready()

  f.relayPassStore.write('更新後的測試通行碼')
  await advance(DEFAULT_IDLE_POLL_MS - 1)
  expect(f.calls).toHaveLength(1)
  await advance(1)
  await until(() => f.calls.length > 1 || Number.isFinite(clock.next()))
  expect(f.calls[1]).toMatchObject({ ids: [head.op_id] })
})

it('交易提交後合併跳號通知，並觀測最外層序號', async () => {
  const [head, second, third] = await add(3)
  const f = setup()
  f.receiptApplier.applyReceipt.mockResolvedValue({ sequence: 'gap', readSinceSeq: 2 })
  f.sender.start()
  const call = await f.call(0)
  call.response.resolve(submit(saved(head.op_id), saved(second.op_id), denied(third.op_id, { code: 'ALREADY_UNDONE' })))
  await until(() => f.onReadNeeded.mock.calls.length)
  await ready()
  expect(f.onReadNeeded.mock.calls).toEqual([[{ ...scope, readSinceSeq: 2 }]])
  expect(f.receiptApplier.observeSubmitSequence).toHaveBeenCalledWith(
    f.receiptApplier.applyReceipt.mock.calls[0][0], scope, committed.class_seq,
  )
  expect(await operations()).toEqual([])
})

it('需要讀取的拒絕收據單獨也發通知', async () => {
  const [head] = await add()
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  call.response.resolve(submit(denied(head.op_id, { code: 'ALREADY_UNDONE' })))
  await until(() => f.onReadNeeded.mock.calls.length)
  expect(f.onReadNeeded.mock.calls).toEqual([[scope]])
})

it('已移出的項目跳過，同一回應的其他筆照常結清', async () => {
  const [head, second] = await add(2)
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  await removeOperation(peer, scope, head.op_id)
  call.response.resolve(submit(denied(head.op_id), saved(second.op_id)))
  await ready()
  expect(await attention()).toEqual([])
  expect(await operations()).toEqual([])
  expect(f.receiptApplier.applyReceipt.mock.calls.map(([, , receipt]) => receipt.op_id)).toEqual([second.op_id])
})

it('送出後改為放棄中，暫時回應留原位而定案照常結清', async () => {
  const [head, second] = await add(2)
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  for (const op of [head, second]) {
    await updateOperation(peer, scope, op.op_id, { status: 'cancelling', lastCode: '原始原因' })
  }
  call.response.resolve(submit(retry(head.op_id, 'SERVER_BUSY'), saved(second.op_id)))
  await f.state('waiting_cancel')
  expect(await operations()).toMatchObject([{ op_id: head.op_id, status: 'cancelling', lastCode: '原始原因' }])
})

it('甲班暫停仍可送完乙班', async () => {
  const [head] = await add()
  const [other] = await add(1, { to: otherClass })
  await updateOperation(peer, scope, head.op_id, { status: 'paused' })
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  expect(call.ids).toEqual([other.op_id])
  await f.state('paused')
  call.response.resolve(submit(saved(other.op_id)))
  await ready()
  expect(await operations(otherClass)).toEqual([])
})

it('限流指定三十秒，期限前不送，到期用同編號重送', async () => {
  const [head] = await add()
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  call.response.resolve(request('RATE_LIMITED', { retry_after: 30 }))
  const waiting = await f.state('waiting_retry')
  expect(waiting.nextAttemptAt).toBe(clock.now() + 30_000)
  await advance(29_999)
  await ready()
  expect(f.calls).toHaveLength(1)
  await advance(1)
  expect((await f.call(1)).ids).toEqual([head.op_id])
})

it('非 JSON 保留連續錯誤次數，退避後同編號重送', async () => {
  const [head] = await add()
  await updateOperation(peer, scope, head.op_id, { consecutiveInternalErrors: 3 })
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  call.response.resolve({ kind: 'http', via: 'direct', status: 200, bodyText: '無法解析' })
  const waiting = await f.state('waiting_retry')
  expect((await operations())[0]).toMatchObject({ consecutiveInternalErrors: 3, lastCode: 'invalid_json' })
  await advance(waiting.nextAttemptAt - clock.now())
  expect((await f.call(1)).ids).toEqual([head.op_id])
})

it('超過上限的班級最前筆保留原狀並回報原因', async () => {
  const [head] = await add(1, { payload: '測'.repeat(22_000) })
  await add()
  const f = setup()
  f.sender.start()
  expect(await f.state('blocked')).toMatchObject({ opId: head.op_id, reason: 'payload_too_large' })
  expect((await operations())[0]).toEqual(head)
  expect(f.calls).toHaveLength(0)
})

it('閒置達預設間隔後送出另一分頁新存的操作', async () => {
  const f = setup()
  f.sender.start()
  await ready()
  expect(clock.next() - clock.now()).toBe(DEFAULT_IDLE_POLL_MS)
  const [head] = await add(1, { connection: peer })
  await advance(DEFAULT_IDLE_POLL_MS)
  expect((await f.call(0)).ids).toEqual([head.op_id])
})

it('狀態、通知與鎖錯誤不帶權杖或通行碼', async () => {
  await add()
  const f = setup()
  f.sender.start()
  const call = await f.call(0)
  call.response.reject(new Error(token + pass))
  await f.state('waiting_retry')
  const missingLock = setup({ locks: undefined })
  expect(() => missingLock.sender.start()).toThrow('送出迴圈需要 Web Locks')
  const brokenLock = setup({ locks: { request() { throw new Error(token + pass) } } })
  expect(() => brokenLock.sender.start()).not.toThrow()
  await until(() => brokenLock.sender.getState().status === 'error')
  const outputs = JSON.stringify([
    f.sender.getState(), f.onReadNeeded.mock.calls, f.onStateChange.mock.calls, brokenLock.onStateChange.mock.calls,
  ])
  expect(outputs).not.toContain(token)
  expect(outputs).not.toContain(pass)
  expect(missingLock.calls).toHaveLength(0)
})

it('缺少收據套用介面時不啟動，也不請求送出權', async () => {
  const requestLock = vi.fn()
  const f = setup({ receiptApplier: undefined, locks: { request: requestLock } })
  expect(() => f.sender.start()).toThrow('送出迴圈需要收據套用介面')
  expect(f.sender.getState()).toMatchObject({ hasLock: false, status: 'stopped' })
  expect(requestLock).not.toHaveBeenCalled()
})
