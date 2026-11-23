import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  CLASS_DATA_STORES, STORAGE_MIGRATIONS, countOtherAccounts, createOperations,
  createOperationsInTransaction, deleteDraft, deleteLocalLogin, deleteLocalLoginInTransaction,
  deleteNeedsAttention, getAccountSetting,
  getClassState, getDeviceSetting, getDraft, getLocalLogin, listNeedsAttention,
  listOperations, openQueueDatabase, removeOperation, removeOperationInTransaction,
  resolveExpect, runStorageTransaction, saveAccountSetting, saveClassState,
  saveClassStateInTransaction, saveDeviceSetting, saveDraft, saveLocalLogin, saveNeedsAttention, serializeEntityKey,
  updateOperation,
} from './queue-storage.js'

const scope = { accountId: '帳號甲', classId: '班級甲' }
const otherAccount = { ...scope, accountId: '帳號乙' }
const otherClass = { ...scope, classId: '班級乙' }
const target = { entity: 'submission', key: { task_id: '作業甲', student_id: '座號一' } }
const reversed = { ...target, key: { student_id: '座號一', task_id: '作業甲' } }
const draft = { entries: [{ seat: 1 }] }
const input = { type: 'submission.set_status', payload: { status: 'missing' } }
const declared = { ...input, targets: [target] }
const automatic = { ...declared, expect: 'auto', expectTarget: reversed }
const at = Date.parse('2026-01-02T03:04:05Z')
const creationStores = ['localLogin', 'classState', 'queueCounters', 'queuedOps', 'queuedTargets', 'confirmedRows']
const duplicateUUID = () => '00000000-0000-4000-8000-000000000001'

let factory
let db
let connections

async function connect(options) {
  const connection = await openQueueDatabase({ factory, ...options })
  connections.push(connection)
  return connection
}

async function putConfirmed(rev, assignment_active) {
  await runStorageTransaction(db, ['confirmedRows'], 'readwrite', tx =>
    tx.objectStore('confirmedRows').put({
      ...scope, entity: target.entity, entityKey: serializeEntityKey(target.key),
      rev, value: { assignment_active },
    }),
  )
}

beforeEach(async () => {
  factory = new IDBFactory()
  connections = []
  db = await connect()
  await saveLocalLogin(db, { accountId: scope.accountId })
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const connection of connections) connection.close()
})

it('批次第二筆撞編號時，第一筆、目標關聯與計數器一同回滾', async () => {
  await expect(createOperations(db, scope, [declared, declared], { randomUUID: duplicateUUID }))
    .rejects.toMatchObject({ name: 'ConstraintError' })
  expect(await listOperations(db, scope)).toEqual([])
  expect(await resolveExpect(db, scope, target)).toEqual({ rev: 0 })
  const [next] = await createOperations(db, scope, [input])
  expect(next.client_seq).toBe(1)
})

it('最後一個請求成功後交易仍可中止，呼叫端收到失敗', async () => {
  const transaction = db.transaction.bind(db)
  let requestSucceeded = false
  const intercept = vi.spyOn(db, 'transaction').mockImplementation((...args) => {
    const tx = transaction(...args)
    const counters = tx.objectStore('queueCounters')
    const put = counters.put.bind(counters)
    vi.spyOn(counters, 'put').mockImplementation(value => {
      const request = put(value)
      request.addEventListener('success', () => {
        requestSucceeded = true
        setImmediate(() => tx.abort())
      })
      return request
    })
    return tx
  })
  await expect(createOperations(db, scope, [declared])).rejects.toMatchObject({ name: 'AbortError' })
  expect(requestSucceeded).toBe(true)
  intercept.mockRestore()
  expect(await listOperations(db, scope)).toEqual([])
  expect(await resolveExpect(db, scope, target)).toEqual({ rev: 0 })
  const [next] = await createOperations(db, scope, [input])
  expect(next.client_seq).toBe(1)
})

it('兩個連線交錯各建十筆，共用連續的排序號', async () => {
  const other = await connect()
  // 回滾後仍須從一開始，避免用模組共用的記憶體預配也能通過。
  await expect(createOperations(other, scope, [input, input], { randomUUID: duplicateUUID }))
    .rejects.toMatchObject({ name: 'ConstraintError' })
  const creating = []
  for (let index = 0; index < 10; index++) {
    creating.push(createOperations(db, scope, [input]), createOperations(other, scope, [input]))
  }
  await Promise.all(creating)
  const operations = await listOperations(other, scope)
  expect(operations.map(operation => operation.client_seq)).toEqual(
    Array.from({ length: 20 }, (_, index) => index + 1),
  )
})

it('跨連線與同批接到最後宣告的待送操作，移出後採已確認版本', async () => {
  const other = await connect()
  const [first] = await createOperations(db, scope, [{ ...declared, type: 'assignment.create' }])
  const [second, third] = await createOperations(other, scope, [automatic, automatic])
  expect(second.expect).toEqual({ after_op: first.op_id })
  expect(third.expect).toEqual({ after_op: second.op_id })
  expect(second.batch_id).toBeTruthy()
  expect(third.batch_id).toBe(second.batch_id)
  for (const status of ['queued', 'sending', 'paused', 'cancelling']) {
    await updateOperation(db, scope, third.op_id, { status })
    expect(await resolveExpect(other, scope, target)).toEqual({ after_op: third.op_id })
  }
  await createOperations(db, scope, [{ ...input, type: 'confirmation.confirm' }])
  expect(await resolveExpect(other, scope, target)).toEqual({ after_op: third.op_id })
  for (const operation of [third, second, first]) await removeOperation(db, scope, operation.op_id)
  await putConfirmed(7, true)
  const [afterRemoval] = await createOperations(other, scope, [automatic])
  expect(afterRemoval.expect).toEqual({ rev: 7 })
})

it('找不到資料時用零，不參與的繳交仍用已確認版本', async () => {
  const [missing] = await createOperations(db, scope, [{ ...automatic, targets: [] }])
  expect(missing.expect).toEqual({ rev: 0 })
  await putConfirmed(9, false)
  const [inactive] = await createOperations(db, scope, [automatic])
  expect(inactive.expect).toEqual({ rev: 9 })
  expect(await resolveExpect(db, otherAccount, target)).toEqual({ rev: 0 })
})

it('升版保留待送與草稿，舊連線回報需要重開', async () => {
  const [saved] = await createOperations(db, scope, [declared])
  await saveDraft(db, scope, '初稿', draft)
  const upgraded = await connect({
    migrations: [...STORAGE_MIGRATIONS, database => database.createObjectStore('migrationProbe')],
  })
  expect(upgraded.objectStoreNames.contains('migrationProbe')).toBe(true)
  expect(await listOperations(upgraded, scope)).toEqual([saved])
  expect(await getDraft(upgraded, scope, '初稿')).toEqual(draft)
  expect(await resolveExpect(upgraded, scope, target)).toEqual({ after_op: saved.op_id })
  await expect(getDraft(db, scope, '初稿')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
  await expect(createOperations(db, scope, [input])).rejects.toThrow('重新開啟')
})

it.each([
  {
    storeName: 'readOperations', primaryField: 'op_id', indexName: 'byClassSequence',
    indexFields: ['class_seq'], row: { op_id: '操作甲', class_seq: 3 },
  },
  {
    storeName: 'readTransactions', primaryField: 'transaction_id', indexName: 'byStudentTime',
    indexFields: ['student_id', 'occurred_at'],
    row: { transaction_id: '交易甲', student_id: '座號一', occurred_at: '2026-01-02T03:04:05Z' },
  },
])('第一版的 $storeName 主鍵與索引直接使用後端欄位', async ({
  storeName, primaryField, indexName, indexFields, row,
}) => {
  expect(db.version).toBe(1)
  const scopeFields = ['accountId', 'classId']
  const record = { ...scope, ...row }
  const found = await runStorageTransaction(db, storeName, 'readwrite', tx => {
    const store = tx.objectStore(storeName)
    const index = store.index(indexName)
    expect(store.keyPath).toEqual([...scopeFields, primaryField])
    expect(index.keyPath).toEqual([...scopeFields, ...indexFields])
    store.add(record)
    return new Promise((resolve, reject) => {
      const request = index.get([...scopeFields, ...indexFields].map(field => record[field]))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  })
  expect(found).toEqual(record)
})

it.each([
  ['登出', 'LOGIN_REQUIRED', connection => deleteLocalLogin(connection)],
  ['換帳號', 'ACCOUNT_MISMATCH', connection => saveLocalLogin(connection, otherAccount)],
])('%s後舊分頁寫入遭拒且既有項目留存', async (_label, code, changeLogin) => {
  const other = await connect()
  const [existing] = await createOperations(db, scope, [declared])
  await changeLogin(other)
  await expect(createOperations(db, scope, [input])).rejects.toMatchObject({ code })
  await expect(saveDraft(db, scope, '初稿', draft)).rejects.toMatchObject({ code })
  await expect(saveNeedsAttention(db, scope, existing, { reason: '測試' })).rejects.toMatchObject({ code })
  await expect(removeOperation(db, scope, existing.op_id, { reason: '測試' })).rejects.toMatchObject({ code })
  expect(await listOperations(db, scope)).toEqual([existing])
  expect(await getDraft(db, scope, '初稿')).toBeUndefined()
  expect(await listNeedsAttention(db, scope)).toEqual([])
})

it.each([
  ['保留並登出', 'LOGIN_REQUIRED', deleteLocalLogin],
  ['換帳號', 'ACCOUNT_MISMATCH', connection => saveLocalLogin(connection, otherAccount)],
])('%s後舊分頁不能改動既有班級資料', async (_label, code, changeLogin) => {
  const other = await connect()
  const [queued, attended] = await createOperations(db, scope, [declared, input])
  const state = await saveClassState(db, scope, { seenSeq: 3, appliedSeq: 2 })
  await saveDraft(db, scope, '初稿', draft)
  await removeOperation(db, scope, attended.op_id, { reason: '待確認' })
  const attention = await listNeedsAttention(db, scope)

  await changeLogin(other)
  const attempts = [
    ['班級狀態', () => saveClassState(db, scope, { notCreated: true })],
    ['送出欄位', () => updateOperation(db, scope, queued.op_id, { status: 'sending' })],
    ['移出待送', () => removeOperation(db, scope, queued.op_id)],
    ['移入需要處理', () => removeOperation(db, scope, queued.op_id, { reason: '測試' })],
    ['移出不存在的待送並附處理原因', () => removeOperation(db, scope, duplicateUUID(), { reason: '測試' })],
    ['刪草稿', () => deleteDraft(db, scope, '初稿')],
    ['刪需要處理', () => deleteNeedsAttention(db, scope, attended.op_id)],
  ]
  const results = await Promise.allSettled(attempts.map(([, write]) => write()))
  for (const [index, [label]] of attempts.entries()) {
    expect.soft(results[index], label).toMatchObject({ status: 'rejected', reason: { code } })
  }
  expect(await getClassState(db, scope)).toEqual(state)
  expect(await listOperations(db, scope)).toEqual([queued])
  expect(await resolveExpect(db, scope, target)).toEqual({ after_op: queued.op_id })
  expect(await getDraft(db, scope, '初稿')).toEqual(draft)
  expect(await listNeedsAttention(db, scope)).toEqual(attention)
})

it('清除班級資料並移除登入的交易排在前面時，另一個連線不能重建班級狀態', async () => {
  const other = await connect()
  await saveClassState(db, scope, { seenSeq: 3 })
  const clearing = runStorageTransaction(other, [...CLASS_DATA_STORES, 'localLogin'], 'readwrite', async tx => {
    for (const store of CLASS_DATA_STORES) tx.objectStore(store).clear()
    await deleteLocalLoginInTransaction(tx)
  })
  const writing = saveClassState(db, scope, { appliedSeq: 2 })
  await expect(writing).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
  await clearing
  expect(await getClassState(db, scope)).toEqual({ ...scope, notCreated: false, seenSeq: 0, appliedSeq: 0 })
})

it('組合交易缺少登入儲存區時指出缺少的儲存區，並回滾先前改動', async () => {
  const state = await saveClassState(db, scope, { seenSeq: 3 })
  const writing = runStorageTransaction(db, 'classState', 'readwrite', async tx => {
    tx.objectStore('classState').delete([scope.accountId, scope.classId])
    await saveClassStateInTransaction(tx, scope, { appliedSeq: 2 })
  })
  await expect(writing).rejects.toMatchObject({
    code: 'TRANSACTION_SCOPE_MISMATCH',
    message: expect.stringContaining('localLogin'),
  })
  expect(await getClassState(db, scope)).toEqual(state)
})

it('沒有建成只擋新增待送與存草稿，仍可更新及完整移入需要處理', async () => {
  const [saved] = await createOperations(db, scope, [{ ...declared, expect: { rev: 3 } }], { now: () => at })
  await saveDraft(db, scope, '初稿', draft)
  await saveClassState(db, scope, { notCreated: true })
  await expect(createOperations(db, scope, [input])).rejects.toMatchObject({ code: 'CLASS_NOT_CREATED' })
  await expect(saveDraft(db, scope, '初稿', {})).rejects.toMatchObject({ code: 'CLASS_NOT_CREATED' })
  expect(await getDraft(db, scope, '初稿')).toEqual(draft)
  const paused = await updateOperation(db, scope, saved.op_id, { status: 'paused' })
  await removeOperation(db, scope, saved.op_id, { reason: '放棄失權', abandonForbidden: true })
  expect(await listOperations(db, scope)).toEqual([])
  expect(await resolveExpect(db, scope, target)).toEqual({ rev: 0 })
  expect(await listNeedsAttention(db, scope)).toEqual([
    { ...scope, op_id: saved.op_id, reason: '放棄失權', abandonForbidden: true, operation: paused },
  ])
  await deleteDraft(db, scope, '初稿')
  expect(await getDraft(db, scope, '初稿')).toBeUndefined()
})

it('排在建立操作後的跨分頁標記交易會看到已寫入的操作', async () => {
  const other = await connect()
  const creating = createOperations(db, scope, [declared])
  const marking = runStorageTransaction(other, ['classState', 'queuedOps'], 'readwrite', async tx => {
    const count = await new Promise((resolve, reject) => {
      const request = tx.objectStore('queuedOps').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    tx.objectStore('classState').put({ ...scope, notCreated: true })
    return count
  })
  const [, count] = await Promise.all([creating, marking])
  expect(count).toBe(1)
  await expect(createOperations(db, scope, [input])).rejects.toMatchObject({ code: 'CLASS_NOT_CREATED' })
})

it('保留 UUID、原信封與時間，只允許四種狀態和送出欄位更新', async () => {
  const [saved, omitted, explicitNull] = await createOperations(db, scope, [
    { ...input, expect: { rev: 3 } }, input, { ...input, expect: null },
  ], { now: () => at })
  expect(saved).toMatchObject({
    ...scope, v: 1, client_seq: 1, type: input.type, payload: input.payload,
    expect: { rev: 3 }, status: 'queued', createdAt: at, client_time: '2026-01-02T03:04:05.000Z',
  })
  expect(saved.op_id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  expect(omitted).not.toHaveProperty('expect')
  expect(explicitNull.expect).toBeNull()
  await expect(updateOperation(db, scope, saved.op_id, { status: 'done' })).rejects.toThrow('狀態')
  await expect(updateOperation(db, scope, saved.op_id, { op_id: duplicateUUID(), payload: {} })).rejects.toThrow('欄位')
  await expect(createOperations(db, scope, [input], { randomUUID: () => '無效' })).rejects.toThrow('UUID')
  const fields = {
    status: 'sending', attempts: 2, nextAttemptAt: at, consecutiveInternalErrors: 1,
    lastCode: 'INTERNAL_ERROR', sendIndividually: true,
  }
  expect(await updateOperation(db, scope, saved.op_id, fields)).toEqual({ ...saved, ...fields })
  expect(await listOperations(db, scope)).toEqual([{ ...saved, ...fields }, omitted, explicitNull])
})

it('列鍵序列化依鍵名排序，保留值與型別', () => {
  expect(serializeEntityKey(target.key)).toBe(serializeEntityKey(reversed.key))
  expect(serializeEntityKey({ student_id: '1' })).not.toBe(serializeEntityKey({ student_id: 1 }))
})

it('列鍵接受含字串、有限數字與布林值的純物件', () => {
  const key = Object.assign(Object.create(null), { 字串: '一', 數字: -1.5, 布林: false })
  expect(JSON.parse(serializeEntityKey(key))).toEqual({ 字串: '一', 數字: -1.5, 布林: false })
})

it('列鍵本身必須是至少有一個屬性的純物件', () => {
  for (const key of [[], '座號一', 1, true, null, undefined, new Date(0), Object.create({ student_id: '座號一' })]) {
    expect(() => serializeEntityKey(key)).toThrow(TypeError)
    expect(() => serializeEntityKey(key)).toThrow('列鍵須為純物件')
  }
  expect(() => serializeEntityKey({})).toThrow(TypeError)
  expect(() => serializeEntityKey({})).toThrow('列鍵至少需要一個屬性')
})

it('列鍵值無效時指出屬性名稱', () => {
  for (const value of [undefined, null, {}, [], NaN, Infinity, -Infinity, 1n, Symbol('座號'), () => {}]) {
    const serialize = () => serializeEntityKey({ task_id: '作業甲', student_id: value })
    expect(serialize).toThrow(TypeError)
    expect(serialize).toThrow('列鍵屬性 student_id 須為字串、有限數字或布林值')
  }
  const symbol = Symbol('座號')
  expect(() => serializeEntityKey({ [symbol]: '座號一' })).toThrow(TypeError)
  expect(() => serializeEntityKey({ [symbol]: '座號一' })).toThrow('Symbol(座號)')
})

it.each([
  ['宣告的目標列', badTarget => ({ ...input, targets: [badTarget] })],
  ['自動版本條件的目標列', badTarget => ({ ...input, expect: 'auto', expectTarget: badTarget })],
])('%s若有無效的列鍵，整批操作回滾', async (_label, makeInput) => {
  const [existing] = await createOperations(db, scope, [input])
  const badTarget = { ...target, key: { ...target.key, student_id: undefined } }
  const creating = createOperations(db, scope, [declared, makeInput(badTarget)])
  await expect(creating).rejects.toThrow(TypeError)
  await expect(creating).rejects.toThrow('列鍵屬性 student_id 須為字串、有限數字或布林值')
  expect(await listOperations(db, scope)).toEqual([existing])
  expect(await resolveExpect(db, scope, target)).toEqual({ rev: 0 })
  const [next] = await createOperations(db, scope, [input])
  expect(next.client_seq).toBe(2)
})

it('依帳號與班級列出待送，別的帳號筆數跨班計算', async () => {
  await createOperations(db, scope, [input])
  await createOperations(db, { ...scope, classId: '班級乙' }, [input])
  await saveLocalLogin(db, otherAccount)
  const [other] = await createOperations(db, otherAccount, [input])
  expect(other.client_seq).toBe(1)
  expect(await listOperations(db, otherAccount)).toEqual([other])
  expect(await countOtherAccounts(db, otherAccount.accountId)).toBe(2)
  expect(await countOtherAccounts(db, scope.accountId)).toBe(1)
})

it('登入與裝置設定隔離，班級狀態局部更新保留獨立序號', async () => {
  expect(await getClassState(db, scope)).toEqual({ ...scope, notCreated: false, seenSeq: 0, appliedSeq: 0 })
  await saveClassState(db, scope, { appliedSeq: 1, seenSeq: 3 })
  await saveClassState(db, scope, { notCreated: true })
  expect(await getClassState(db, scope)).toEqual({ ...scope, notCreated: true, seenSeq: 3, appliedSeq: 1 })
  await saveDeviceSetting(db, '防誤觸設定', true)
  await saveAccountSetting(db, scope.accountId, '進班開關', true)
  expect(await getAccountSetting(db, otherAccount.accountId, '進班開關')).toBeUndefined()
  expect(await getLocalLogin(db)).toEqual({ accountId: scope.accountId })
  await deleteLocalLogin(db)
  expect(await getLocalLogin(db)).toBeUndefined()
  expect(await getDeviceSetting(db, '防誤觸設定')).toBe(true)
  expect(await getAccountSetting(db, scope.accountId, '進班開關')).toBe(true)
  expect(CLASS_DATA_STORES).toEqual(expect.arrayContaining(['queuedOps', 'checkInDrafts', 'needsAttention', 'confirmedRows']))
  for (const store of ['localLogin', 'deviceSettings', 'accountSettings']) {
    expect(CLASS_DATA_STORES).not.toContain(store)
  }
})

it('接受外部交易組合寫入，任何一步失敗就一起回滾', async () => {
  const [first] = await createOperations(db, scope, [declared])
  await expect(runStorageTransaction(db, [...creationStores, 'needsAttention'], 'readwrite', async tx => {
    await removeOperationInTransaction(tx, scope, first.op_id, { reason: '測試' })
    await createOperationsInTransaction(tx, scope, [input], { randomUUID: () => '無效' })
  })).rejects.toThrow('UUID')
  expect(await listOperations(db, scope)).toEqual([first])
  expect(await listNeedsAttention(db, scope)).toEqual([])
  expect(await resolveExpect(db, scope, target)).toEqual({ after_op: first.op_id })
})

it('刪需要處理只刪指定一筆，沒有建成的班也可刪除', async () => {
  const [first, second] = await createOperations(db, scope, [input, input])
  await removeOperation(db, scope, first.op_id, { reason: '測試甲' })
  await removeOperation(db, scope, second.op_id, { reason: '測試乙' })
  await saveClassState(db, scope, { notCreated: true })
  await deleteNeedsAttention(db, scope, first.op_id)
  expect(await listNeedsAttention(db, scope)).toEqual([
    { ...scope, op_id: second.op_id, reason: '測試乙', operation: second },
  ])
})

it.each([
  ['操作不存在', undefined],
  ['操作屬於別的帳號', otherAccount],
  ['操作屬於別的班級', otherClass],
])('%s時更新與移出皆回 undefined，所有待送與需要處理資料留存', async (_label, originalScope) => {
  const [existing] = await createOperations(db, scope, [declared], { randomUUID: duplicateUUID })
  let foreign
  if (originalScope) {
    await saveLocalLogin(db, originalScope)
    const [operation] = await createOperations(db, originalScope, [declared])
    foreign = operation
    await saveLocalLogin(db, scope)
  }
  const opId = foreign?.op_id ?? '00000000-0000-4000-8000-000000000002'
  await expect(updateOperation(db, scope, opId, { status: 'sending' })).resolves.toBeUndefined()
  await expect(removeOperation(db, scope, opId)).resolves.toBeUndefined()
  await expect(removeOperation(db, scope, opId, { reason: '測試' })).resolves.toBeUndefined()
  expect(await listOperations(db, scope)).toEqual([existing])
  expect(await resolveExpect(db, scope, target)).toEqual({ after_op: existing.op_id })
  expect(await listNeedsAttention(db, scope)).toEqual([])
  if (foreign) {
    expect(await listOperations(db, originalScope)).toEqual([foreign])
    expect(await resolveExpect(db, originalScope, target)).toEqual({ after_op: foreign.op_id })
    expect(await listNeedsAttention(db, originalScope)).toEqual([])
  }
})

it.each([
  ['別的帳號', otherAccount],
  ['別的班級', otherClass],
])('原操作屬於%s時，寫需要處理回 OPERATION_SCOPE_MISMATCH', async (_label, originalScope) => {
  await saveLocalLogin(db, originalScope)
  const [foreign] = await createOperations(db, originalScope, [input])
  await saveLocalLogin(db, scope)
  await expect(saveNeedsAttention(db, scope, foreign, { reason: '測試' }))
    .rejects.toMatchObject({ code: 'OPERATION_SCOPE_MISMATCH' })
  expect(await listNeedsAttention(db, scope)).toEqual([])
  expect(await listOperations(db, originalScope)).toEqual([foreign])
})

it('單筆的 batch_id 為 null，多筆的 batch_id 都是第一筆的 op_id', async () => {
  const [single] = await createOperations(db, scope, [input])
  const batch = await createOperations(db, scope, [input, input, input])
  expect((await listOperations(db, scope)).map(operation => operation.batch_id))
    .toEqual([null, batch[0].op_id, batch[0].op_id, batch[0].op_id])
  expect(single.batch_id).toBeNull()
})

it('同一操作重複宣告同一列時只留一筆目標關聯', async () => {
  const [operation] = await createOperations(db, scope, [{ ...input, targets: [target, reversed, target] }])
  const relations = await runStorageTransaction(db, 'queuedTargets', 'readonly', tx =>
    new Promise((resolve, reject) => {
      const request = tx.objectStore('queuedTargets').index('byOperation').getAll(operation.op_id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }),
  )
  expect(relations).toEqual([{
    ...scope, op_id: operation.op_id, client_seq: operation.client_seq,
    entity: target.entity, entityKey: serializeEntityKey(target.key),
  }])
})

it('班級狀態拒絕非布林標記與負數或非整數序號，原狀態留存', async () => {
  const state = await saveClassState(db, scope, { notCreated: true, seenSeq: 3, appliedSeq: 2 })
  for (const patch of [{ notCreated: '是' }, { seenSeq: -1 }, { seenSeq: 1.5 }, { appliedSeq: -1 }, { appliedSeq: 1.5 }]) {
    await expect(saveClassState(db, scope, patch)).rejects.toThrow(TypeError)
    expect(await getClassState(db, scope)).toEqual(state)
  }
})

it('寫本機登入紀錄缺少帳號時丟 TypeError 並保留原帳號', async () => {
  await expect(saveLocalLogin(db, {})).rejects.toThrow(TypeError)
  expect(await getLocalLogin(db)).toEqual({ accountId: scope.accountId })
})
