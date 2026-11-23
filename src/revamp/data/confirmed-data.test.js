import { afterEach, beforeEach, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import committed from '../../../docs/revamp/frontend-queue/samples/submit-committed.json'
import replay from '../../../docs/revamp/frontend-queue/samples/submit-replay.json'
import noop from '../../../docs/revamp/frontend-queue/samples/submit-noop.json'
import undo from '../../../docs/revamp/frontend-queue/samples/submit-undo.json'
import batchUndo from '../../../docs/revamp/frontend-queue/samples/submit-batch-undo.json'
import confirmHeld from '../../../docs/revamp/frontend-queue/samples/submit-confirm-held.json'
import rejected from '../../../docs/revamp/frontend-queue/samples/submit-rejected.json'
import incremental from '../../../docs/revamp/frontend-queue/samples/read-changes-incremental.json'
import {
  createOperations, deleteLocalLogin, deleteLocalLoginInTransaction, getClassState,
  listOperations, openQueueDatabase, removeOperationInTransaction, resolveExpect,
  runStorageTransaction, saveClassState, saveLocalLogin,
} from '../storage/queue-storage.js'
import {
  RECEIPT_APPLY_STORES, applyReadRowsInTransaction, applyReceiptInTransaction,
  advanceReadSequenceInTransaction, listConfirmedRows, listConfirmedRowsByEntity,
  listConfirmedRowsByEntityInTransaction, listConfirmedRowsInTransaction,
  observeSubmitSequenceInTransaction,
} from './confirmed-data.js'

const scope = { accountId: '帳號甲', classId: '班級甲' }
const otherClass = { ...scope, classId: '班級乙' }
const otherAccount = { ...scope, accountId: '帳號乙' }
const task = { entity: 'task', key: { task_id: '作業甲' } }
const opId = '00000000-0000-4000-8000-000000000001'
const row = (rev, value) => ({ ...task, rev, value })
const receipt = (class_seq, ...changes) => ({ status: 'committed', class_seq, changes })

let db
let secondDb

beforeEach(async () => {
  const factory = new IDBFactory()
  db = await openQueueDatabase({ factory })
  secondDb = await openQueueDatabase({ factory })
  await saveLocalLogin(db, { accountId: scope.accountId })
})

afterEach(() => {
  db?.close()
  secondDb?.close()
})

function write(work, connection = db, stores = RECEIPT_APPLY_STORES) {
  return runStorageTransaction(connection, stores, 'readwrite', work)
}

function apply(item, connection = db) {
  return write(tx => applyReceiptInTransaction(tx, scope, item), connection)
}

function readRows(rows, targetScope = scope) {
  return write(tx => applyReadRowsInTransaction(tx, targetScope, rows))
}

it('舊重送收據保留第五版與兩個序號', async () => {
  const original = replay.receipts[0]
  const [change] = original.changes
  await readRows([{ ...change, rev: 5, value: { status: '已補交' } }])
  await saveClassState(db, scope, { seenSeq: 12, appliedSeq: 9 })
  const before = await listConfirmedRowsByEntity(db, scope, change.entity)
  expect(original.replayed).toBe(true)
  expect(await apply({
    ...original, changes: [{ ...change, prev_rev: 3, rev: 4 }],
  })).toEqual({ sequence: 'old' })
  expect(await listConfirmedRows(db, scope)).toEqual(before)
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 12, appliedSeq: 9 })
})

it('局部欄位淺層合併且允許空值', async () => {
  await readRows([row(1, { 甲: '保留', 乙: '舊值' })])
  await apply(receipt(1, { ...row(2, { 乙: '新值' }), prev_rev: 1 }))
  expect(await listConfirmedRows(db, scope)).toMatchObject([
    { rev: 2, value: { 甲: '保留', 乙: '新值' } },
  ])
  await apply(receipt(2, { ...row(3, null), prev_rev: 2, last_op_id: null }))
  expect(await listConfirmedRows(db, scope)).toMatchObject([
    { rev: 3, value: null, last_op_id: null },
  ])
})

it('連號收據在列寫入後推進序號', async () => {
  await saveClassState(db, scope, { seenSeq: 1, appliedSeq: 1, notCreated: true })
  for (const item of committed.receipts) {
    expect(await apply(item)).toEqual({ sequence: 'next' })
    expect(await getClassState(db, scope)).toMatchObject({ appliedSeq: item.class_seq })
  }
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 3, appliedSeq: 3, notCreated: true })
  expect(await listConfirmedRows(db, scope)).toHaveLength(
    committed.receipts.flatMap(item => item.changes).length,
  )
})

it('整批撤銷保留補讀起點且只提高看過的序號', async () => {
  const [item] = batchUndo.receipts
  const undone = item.result.items.filter(entry => entry.outcome === 'undone')
  const appliedSeq = item.class_seq - undone.length - 1
  expect(undone.length).toBeGreaterThan(0)
  await saveClassState(db, scope, { seenSeq: appliedSeq, appliedSeq })
  expect(await apply(item)).toEqual({ sequence: 'gap', readSinceSeq: appliedSeq })
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: item.class_seq, appliedSeq })
  expect(await listConfirmedRows(db, scope)).toEqual([])
})

it('拒絕收據即使帶序號與列也不寫資料', async () => {
  const before = await getClassState(db, scope)
  for (const item of rejected.receipts) {
    expect(await apply(item)).toEqual({ sequence: 'ignored' })
  }
  expect(await apply({ ...rejected.receipts[0], ...{ class_seq: 1, changes: [row(1, {})] } }))
    .toEqual({ sequence: 'ignored' })
  expect(await listConfirmedRows(db, scope)).toEqual([])
  expect(await getClassState(db, scope)).toEqual(before)
})

it('提交外層只觀察序號而無效單筆序號仍可套用列', async () => {
  await saveClassState(db, scope, { seenSeq: 4, appliedSeq: 2 })
  for (const seq of [batchUndo.class_seq, null, 3]) {
    expect(await write(tx => observeSubmitSequenceInTransaction(tx, scope, seq))).toBeUndefined()
  }
  expect(await apply(receipt(null, { ...row(1, {}), prev_rev: 0 }))).toEqual({ sequence: 'ignored' })
  expect(await listConfirmedRows(db, scope)).toMatchObject([{ ...task, rev: 1 }])
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: batchUndo.class_seq, appliedSeq: 2 })
})

it('暫緩批次確認跳號時仍寫入外層的確認列', async () => {
  const [item] = confirmHeld.receipts
  const [change] = item.changes
  const appliedSeq = item.class_seq - 2
  await saveClassState(db, scope, { seenSeq: appliedSeq, appliedSeq })
  expect(await apply(item)).toEqual({ sequence: 'gap', readSinceSeq: appliedSeq })
  expect(await listConfirmedRows(db, scope)).toMatchObject([
    { entity: 'confirmation', key: change.key, rev: change.rev, value: change.value },
  ])
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: item.class_seq, appliedSeq })
})

it('撤銷保留不參與的繳交版本並更新基準與帳戶', async () => {
  await apply(committed.receipts[1])
  const [item] = undo.receipts
  const [submission, account] = item.changes
  expect(submission.prev_basis_rev).toBe(1)
  await apply(item)
  const [stored] = await listConfirmedRowsByEntity(db, scope, 'submission')
  expect(stored).toMatchObject({
    rev: submission.rev, basis_rev: 0, last_op_id: submission.last_op_id,
    value: { assignment_active: false },
  })
  expect(await resolveExpect(db, scope, stored)).toEqual({ rev: submission.rev })
  expect(await listConfirmedRowsByEntity(db, scope, 'account')).toMatchObject([
    { entity: 'account', rev: account.rev, value: { balance: 0, total_earned: 0 } },
  ])
})

it('不改資料的收據保留同版資料並推進連號', async () => {
  await saveClassState(db, scope, { seenSeq: 2, appliedSeq: 2 })
  await apply(committed.receipts[1])
  const before = await listConfirmedRows(db, scope)
  const [item] = noop.receipts
  expect(item.result.noop).toBe(true)
  expect(await apply(item)).toEqual({ sequence: 'next' })
  expect(await listConfirmedRows(db, scope)).toEqual(before)
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 4, appliedSeq: 4 })
})

it('增量較新版整列取代並移除舊版中繼資料', async () => {
  const [latest] = incremental.rows
  await apply(receipt(1, {
    ...latest, rev: latest.rev - 1, prev_rev: 0, last_op_id: opId,
    basis_rev: 1, value: { 舊欄位: true },
  }, { ...row(1, {}), prev_rev: 0 }))
  await readRows(incremental.rows)
  await readRows([
    { ...latest, value: { 同版欄位: true } },
    { ...latest, rev: latest.rev - 1, value: { 舊版欄位: true } },
  ])
  const [stored] = await listConfirmedRowsByEntity(db, scope, latest.entity)
  expect(stored.rev).toBe(latest.rev)
  expect(stored.value).toEqual(latest.value)
  expect(stored).not.toHaveProperty('basis_rev')
  expect(stored).not.toHaveProperty('last_op_id')
  expect(await listConfirmedRowsByEntity(db, scope, 'task')).toHaveLength(1)
})

it('同版完整列修補跳版且保留收據中繼資料', async () => {
  await apply(receipt(1, { ...row(3, { 乙: '局部' }), prev_rev: 2, basis_rev: 0, last_op_id: opId }))
  await apply(receipt(2, { ...row(4, { 乙: '連續' }), prev_rev: 3, basis_rev: 4, last_op_id: opId }))
  expect(await listConfirmedRows(db, scope)).toMatchObject([{ incomplete: true }])
  await readRows([row(3, { 甲: '舊讀取' })])
  expect(await listConfirmedRows(db, scope)).toMatchObject([{ rev: 4, incomplete: true }])
  await readRows([row(4, { 甲: '完整', 乙: '完整' })])
  const [repaired] = await listConfirmedRows(db, scope)
  expect(repaired).toMatchObject({ rev: 4, basis_rev: 4, last_op_id: opId, value: { 甲: '完整', 乙: '完整' } })
  expect(repaired).not.toHaveProperty('incomplete')
  await apply(receipt(3, { ...row(5, { 乙: '更新' }), prev_rev: 4 }))
  const [continuous] = await listConfirmedRows(db, scope)
  expect(continuous).not.toHaveProperty('incomplete')
  expect(continuous.value).toEqual({ 甲: '完整', 乙: '更新' })
})

it('讀取套用完成後才推進兩個序號且不倒退', async () => {
  await saveClassState(db, scope, { seenSeq: 20, appliedSeq: 1 })
  await readRows(incremental.rows)
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 20, appliedSeq: 1 })
  await write(tx => advanceReadSequenceInTransaction(tx, scope, incremental.class_seq))
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 20, appliedSeq: incremental.class_seq })
  await write(tx => advanceReadSequenceInTransaction(tx, scope, 25))
  await write(tx => advanceReadSequenceInTransaction(tx, scope, 3))
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 25, appliedSeq: 25 })
})

it.each(['LOGIN_REQUIRED', 'ACCOUNT_MISMATCH', 'TRANSACTION_SCOPE_MISMATCH'])(
  '收據與讀取列都需要同一交易的登入檢查 %s', async code => {
    if (code === 'LOGIN_REQUIRED') await deleteLocalLogin(db)
    if (code === 'ACCOUNT_MISMATCH') await saveLocalLogin(db, { accountId: otherAccount.accountId })
    const stores = code === 'TRANSACTION_SCOPE_MISMATCH'
      ? RECEIPT_APPLY_STORES.filter(store => store !== 'localLogin')
      : RECEIPT_APPLY_STORES
    const before = await getClassState(db, scope)
    const target = row(1, {})
    await expect(write(tx => applyReceiptInTransaction(tx, scope, receipt(1, { ...target, prev_rev: 0 })), db, stores))
      .rejects.toMatchObject({ code })
    await expect(write(tx => applyReadRowsInTransaction(tx, scope, [target]), db, stores))
      .rejects.toMatchObject({ code })
    expect(await listConfirmedRows(db, scope)).toEqual([])
    expect(await getClassState(db, scope)).toEqual(before)
  },
)

it('同一交易刪除登入後的收據與讀取寫入會回滾', async () => {
  const target = row(1, {})
  for (const work of [
    tx => applyReceiptInTransaction(tx, scope, receipt(1, { ...target, prev_rev: 0 })),
    tx => applyReadRowsInTransaction(tx, scope, [target]),
  ]) {
    await expect(write(async tx => {
      await deleteLocalLoginInTransaction(tx)
      await work(tx)
    })).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
    expect(await listConfirmedRows(secondDb, scope)).toEqual([])
  }
  await readRows([target])
  expect(await listConfirmedRows(db, scope)).toHaveLength(1)
})

it('收據與移出待送清單一起提交或回滾', async () => {
  await createOperations(db, scope, [{ type: '測試操作', payload: {}, targets: [task] }], { randomUUID: () => opId })
  const settle = async tx => {
    expect(await applyReceiptInTransaction(tx, scope, receipt(1, { ...row(1, {}), prev_rev: 0 })))
      .toEqual({ sequence: 'next' })
    await removeOperationInTransaction(tx, scope, opId)
  }
  const stores = [...RECEIPT_APPLY_STORES, 'queuedOps']
  await expect(write(settle, db, stores)).rejects.toMatchObject({ name: 'NotFoundError' })
  expect(await listConfirmedRows(db, scope)).toEqual([])
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 0, appliedSeq: 0 })
  expect(await listOperations(db, scope)).toMatchObject([{ op_id: opId }])
  await write(settle, db, [...stores, 'queuedTargets'])
  expect(await listOperations(db, scope)).toEqual([])
  expect(await listConfirmedRows(db, scope)).toMatchObject([{ rev: 1 }])
  expect(await getClassState(db, scope)).toMatchObject({ seenSeq: 1, appliedSeq: 1 })
})

it('兩個分頁的連號收據讀取同一份交易序號', async () => {
  await saveClassState(db, scope, { seenSeq: 1, appliedSeq: 1 })
  const [first, second] = committed.receipts
  expect(await Promise.all([apply(first), apply(second, secondDb)]))
    .toEqual([{ sequence: 'next' }, { sequence: 'next' }])
  expect(await getClassState(secondDb, scope)).toMatchObject({ seenSeq: 3, appliedSeq: 3 })
  expect(await listConfirmedRows(db, scope)).toHaveLength(first.changes.length + second.changes.length)
})

it('確認列讀取依帳號班級隔離並可依實體篩選', async () => {
  const account = { entity: 'account', key: { student_id: '學生甲' }, rev: 1, value: {} }
  await readRows([row(1, {}), account])
  await readRows([row(2, {})], otherClass)
  await saveLocalLogin(db, { accountId: otherAccount.accountId })
  await readRows([row(3, {})], otherAccount)
  const [all, tasks, absent] = await runStorageTransaction(secondDb, 'confirmedRows', 'readonly', tx =>
    Promise.all([
      listConfirmedRowsInTransaction(tx, scope),
      listConfirmedRowsByEntityInTransaction(tx, scope, 'task'),
      listConfirmedRowsByEntityInTransaction(tx, scope, 'student'),
    ]),
  )
  expect(all).toHaveLength(2)
  expect(all).toEqual(await listConfirmedRows(db, scope))
  expect(tasks).toEqual(await listConfirmedRowsByEntity(db, scope, 'task'))
  expect(tasks).toMatchObject([{ ...scope, ...task, entityKey: '{"task_id":"作業甲"}', rev: 1 }])
  expect(absent).toEqual([])
})
