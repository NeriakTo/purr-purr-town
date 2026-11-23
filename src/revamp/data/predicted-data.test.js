import { expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  createOperations, listNeedsAttention, openQueueDatabase, removeOperation, runStorageTransaction,
  saveLocalLogin, updateOperation,
} from '../storage/queue-storage.js'
import { RECEIPT_APPLY_STORES, applyReadRowsInTransaction } from './confirmed-data.js'
import { projectRows, readProjectedRows } from './predicted-data.js'

const scope = { accountId: '帳號甲', classId: '班級甲' }
const target = { entity: 'account', key: { student_id: '學生甲' } }
const other = { entity: 'account', key: { student_id: '學生乙' } }
const confirmed = Object.freeze([Object.freeze({
  ...scope, ...target, key: Object.freeze(target.key), entityKey: '{"student_id":"學生甲"}',
  rev: 5, value: Object.freeze({ balance: 10, total_earned: 20 }),
})])
const projectors = Object.freeze({
  加點: (operation, readValue) => [{
    ...target, value: { balance: readValue(target.entity, target.key).balance + operation.payload.points },
  }],
  倍增: (operation, readValue) => [{
    ...target, value: { balance: readValue(target.entity, target.key).balance * operation.payload.factor },
  }],
  只等收據: () => null,
})

it('預估依序重套四種待送狀態且保留確認版本', () => {
  const operations = Object.freeze([
    Object.freeze({ op_id: '甲', client_seq: 1, status: 'queued', type: '加點', payload: Object.freeze({ points: 2 }) }),
    Object.freeze({ op_id: '乙', client_seq: 2, status: 'sending', type: '倍增', payload: Object.freeze({ factor: 3 }) }),
    Object.freeze({ op_id: '丙', client_seq: 3, status: 'paused', type: '加點', payload: Object.freeze({ points: 1 }) }),
    Object.freeze({ op_id: '丁', client_seq: 4, status: 'cancelling', type: '加點', payload: Object.freeze({ points: 1 }) }),
  ])
  const result = projectRows(confirmed, operations, projectors)
  expect(result).toEqual({
    rows: [{
      ...confirmed[0], value: { balance: 38, total_earned: 20 },
      pendingOperations: operations.map(({ op_id, status }) => ({ op_id, status })),
    }],
    unprojectedOperations: [],
  })
  expect(confirmed[0].value.balance).toBe(10)
})

it('缺少預估函式或回空值時列出該筆且不改列', () => {
  const operations = [
    { op_id: '甲', client_seq: 1, status: 'queued', type: '購買' },
    { op_id: '乙', client_seq: 2, status: 'paused', type: '只等收據' },
    { op_id: '丙', client_seq: 3, status: 'sending', type: 'toString' },
  ]
  expect(projectRows(confirmed, operations, projectors)).toEqual({
    rows: [{ ...confirmed[0], pendingOperations: [] }],
    unprojectedOperations: operations.map(({ op_id, status }) => ({ op_id, status })),
  })
})

it('純預估可新增列並對複合鍵排序且每筆操作只標記一次', () => {
  const ordered = { entity: 'submission', key: { task_id: '作業甲', student_id: '學生甲' } }
  const reversed = { ...ordered, key: { student_id: '學生甲', task_id: '作業甲' } }
  const operations = [{ op_id: '甲', client_seq: 1, status: 'queued', type: '新增' }]
  const result = projectRows([], operations, {
    新增(_operation, readValue) {
      expect(readValue(ordered.entity, ordered.key)).toBeUndefined()
      return [{ ...ordered, value: { status: 'pending' } }, { ...reversed, value: { assignment_active: true } }]
    },
  })
  expect(result.rows).toEqual([{
    ...ordered, entityKey: '{"student_id":"學生甲","task_id":"作業甲"}', rev: null,
    value: { status: 'pending', assignment_active: true },
    pendingOperations: [{ op_id: '甲', status: 'queued' }],
  }])
})

it('待送移到需要處理後從同一班級快照重算', async () => {
  const db = await openQueueDatabase({ factory: new IDBFactory() })
  try {
    await saveLocalLogin(db, { accountId: scope.accountId })
    await runStorageTransaction(db, RECEIPT_APPLY_STORES, 'readwrite', tx =>
      applyReadRowsInTransaction(tx, scope, [...confirmed, { ...other, rev: 1, value: { balance: 0 } }]),
    )
    const [first, second] = await createOperations(db, scope, [
      { type: '加點', payload: { points: 2 } },
      { type: '倍增', payload: { factor: 3 } },
    ])
    await updateOperation(db, scope, second.op_id, { status: 'sending' })
    const before = await readProjectedRows(db, scope, projectors)
    expect(before.rows).toHaveLength(2)
    expect(before.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ ...target, rev: 5, value: { balance: 36, total_earned: 20 }, pendingOperations: [
        { op_id: first.op_id, status: 'queued' }, { op_id: second.op_id, status: 'sending' },
      ] }),
      expect.objectContaining({ ...other, value: { balance: 0 }, pendingOperations: [] }),
    ]))
    await removeOperation(db, scope, first.op_id, { reason: '測試拒絕' })
    expect(await listNeedsAttention(db, scope)).toMatchObject([{ op_id: first.op_id }])
    const after = await readProjectedRows(db, scope, projectors)
    expect(after.rows.find(item => item.key.student_id === target.key.student_id)).toMatchObject({
      rev: 5, value: { balance: 30 }, pendingOperations: [{ op_id: second.op_id, status: 'sending' }],
    })
  } finally {
    db.close()
  }
})
