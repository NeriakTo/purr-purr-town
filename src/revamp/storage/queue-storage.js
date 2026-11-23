import { openDatabase } from './idb.js'

const DATABASE_NAME = 'ppt-revamp'
const CLASS_KEY = ['accountId', 'classId']
const TARGET_KEY = [...CLASS_KEY, 'entity', 'entityKey']
const DRAFT_KEY = [...CLASS_KEY, 'draftId']
const EXPECT_STORES = ['queuedTargets', 'confirmedRows']
const LOGIN_STORE = 'localLogin'
const CLASS_STATE_STORE = 'classState'
const QUEUE_STORE = 'queuedOps'
const ATTENTION_STORE = 'needsAttention'
const DRAFT_STORE = 'checkInDrafts'
const DEVICE_SETTINGS_STORE = 'deviceSettings'
const ACCOUNT_SETTINGS_STORE = 'accountSettings'
const CREATE_STORES = [LOGIN_STORE, CLASS_STATE_STORE, 'queueCounters', QUEUE_STORE, ...EXPECT_STORES]
const SEND_FIELDS = ['status', 'attempts', 'nextAttemptAt', 'consecutiveInternalErrors', 'lastCode', 'sendIndividually']
const QUEUE_STATUSES = ['queued', 'sending', 'paused', 'cancelling']
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const INITIAL_CLASS_STATE = { notCreated: false, seenSeq: 0, appliedSeq: 0 }

export const CLASS_DATA_STORES = Object.freeze([
  CLASS_STATE_STORE, 'queueCounters', QUEUE_STORE, 'queuedTargets', ATTENTION_STORE, DRAFT_STORE,
  'checkInHistory', 'confirmedRows', 'readOperations', 'readTransactions', 'derivedState',
])

// 新版依序追加步驟，保留既有的待送與草稿。
export const STORAGE_MIGRATIONS = Object.freeze([
  db => {
    db.createObjectStore(LOGIN_STORE)
    db.createObjectStore(DEVICE_SETTINGS_STORE)
    db.createObjectStore(ACCOUNT_SETTINGS_STORE)
    db.createObjectStore(CLASS_STATE_STORE, { keyPath: CLASS_KEY }).createIndex('byAccount', 'accountId')
    db.createObjectStore('queueCounters', { keyPath: CLASS_KEY })

    const operations = db.createObjectStore(QUEUE_STORE, { keyPath: 'op_id' })
    operations.createIndex('byClassSequence', [...CLASS_KEY, 'client_seq'], { unique: true })
    operations.createIndex('byAccountStatus', ['accountId', 'status'])
    operations.createIndex('byClass', CLASS_KEY)
    operations.createIndex('byAccount', 'accountId')

    const targets = db.createObjectStore('queuedTargets', { keyPath: [...TARGET_KEY, 'client_seq'] })
    targets.createIndex('byOperation', 'op_id')
    targets.createIndex('byTarget', TARGET_KEY)

    const attention = db.createObjectStore(ATTENTION_STORE, { keyPath: [...CLASS_KEY, 'op_id'] })
    attention.createIndex('byClassReason', [...CLASS_KEY, 'reason'])
    attention.createIndex('byClass', CLASS_KEY)
    db.createObjectStore(DRAFT_STORE, { keyPath: DRAFT_KEY }).createIndex('byClass', CLASS_KEY)
    db.createObjectStore('checkInHistory', { keyPath: CLASS_KEY })
    db.createObjectStore('confirmedRows', { keyPath: TARGET_KEY })
      .createIndex('byClassEntity', [...CLASS_KEY, 'entity'])
    db.createObjectStore('readOperations', { keyPath: [...CLASS_KEY, 'op_id'] })
      .createIndex('byClassSequence', [...CLASS_KEY, 'class_seq'])
    db.createObjectStore('readTransactions', { keyPath: [...CLASS_KEY, 'transaction_id'] })
      .createIndex('byStudentTime', [...CLASS_KEY, 'student_id', 'occurred_at'])
    db.createObjectStore('derivedState', { keyPath: CLASS_KEY })
  },
])

export function openQueueDatabase({ factory = globalThis.indexedDB, migrations = STORAGE_MIGRATIONS } = {}) {
  return openDatabase({
    factory,
    name: DATABASE_NAME,
    version: migrations.length,
    upgrade(db, oldVersion, transaction) {
      for (const migrate of migrations.slice(oldVersion)) migrate(db, transaction)
    },
  })
}

class StorageError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
}

function abortTransaction(transaction) {
  try {
    transaction.abort()
  } catch (error) {
    // 交易可能已因請求錯誤自行中止。
    if (error.name !== 'InvalidStateError') throw error
  }
}

// 組合式寫入失敗時，也回滾呼叫端在同一交易內先前寫入的資料。
async function writeInTransaction(transaction, work) {
  try {
    return await work()
  } catch (error) {
    abortTransaction(transaction)
    throw error
  }
}

// 回呼內可接續 IndexedDB 請求。交易完成事件才代表成功。
export async function runStorageTransaction(db, stores, mode, work) {
  let transaction
  try {
    const options = mode === 'readwrite' ? { durability: 'strict' } : undefined
    transaction = db.transaction(stores, mode, options)
  } catch (error) {
    if (error.name !== 'InvalidStateError') throw error
    throw new StorageError('DATABASE_CLOSED', '資料庫連線已關閉，需要重新開啟', { cause: error })
  }

  const done = new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true })
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new DOMException('資料庫交易已中止', 'AbortError'))
    }, { once: true })
  })
  void done.catch(() => {})
  try {
    const result = await work(transaction)
    await done
    return result
  } catch (error) {
    abortTransaction(transaction)
    await done.catch(() => {})
    throw error
  }
}

function classKey({ accountId, classId }) {
  return [accountId, classId]
}

export function serializeEntityKey(key) {
  if (key === null || typeof key !== 'object' || Array.isArray(key)) throw new TypeError('列鍵須為純物件')
  const prototype = Object.getPrototypeOf(key)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('列鍵須為純物件')

  const properties = Reflect.ownKeys(key)
  if (properties.length === 0) throw new TypeError('列鍵至少需要一個屬性')
  const fields = Object.create(null)
  for (const property of properties) {
    if (typeof property !== 'string') throw new TypeError(`列鍵屬性 ${String(property)} 須以字串命名`)
    const value = key[property]
    if (typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)) {
      throw new TypeError(`列鍵屬性 ${property} 須為字串、有限數字或布林值`)
    }
    fields[property] = value
  }
  return JSON.stringify(fields, properties.sort())
}

export function getLocalLoginInTransaction(tx) {
  return requestResult(tx.objectStore(LOGIN_STORE).get('current'))
}

export function getLocalLogin(db) {
  return runStorageTransaction(db, LOGIN_STORE, 'readonly', getLocalLoginInTransaction)
}

async function requireLogin(tx, accountId) {
  if (!tx.objectStoreNames.contains(LOGIN_STORE)) {
    throw new StorageError('TRANSACTION_SCOPE_MISMATCH', `班級資料的寫入交易須涵蓋 ${LOGIN_STORE} 儲存區`)
  }
  const login = await getLocalLoginInTransaction(tx)
  if (!login) throw new StorageError('LOGIN_REQUIRED', '本機沒有登入紀錄')
  if (login.accountId !== accountId) throw new StorageError('ACCOUNT_MISMATCH', '本機登入帳號與操作帳號不符')
}

function writeClassDataInTransaction(tx, scope, work) {
  return writeInTransaction(tx, async () => {
    await requireLogin(tx, scope.accountId)
    return work()
  })
}

export async function getClassStateInTransaction(tx, scope) {
  const [accountId, classId] = classKey(scope)
  const stored = await requestResult(tx.objectStore(CLASS_STATE_STORE).get([accountId, classId]))
  return { ...INITIAL_CLASS_STATE, ...stored, accountId, classId }
}

export function getClassState(db, scope) {
  return runStorageTransaction(db, CLASS_STATE_STORE, 'readonly', tx => getClassStateInTransaction(tx, scope))
}

async function requireCreatedOrPendingClass(tx, scope) {
  const state = await getClassStateInTransaction(tx, scope)
  if (state.notCreated) throw new StorageError('CLASS_NOT_CREATED', '這個班沒有建成')
}

export async function resolveExpectInTransaction(tx, scope, { entity, key }) {
  const rowKey = [...classKey(scope), entity, serializeEntityKey(key)]
  const targets = tx.objectStore('queuedTargets').index('byTarget')
  // 索引鍵相同時，游標依含排序號的主鍵反向走。
  const last = await requestResult(targets.openCursor(rowKey, 'prev'))
  if (last) return { after_op: last.value.op_id }
  const row = await requestResult(tx.objectStore('confirmedRows').get(rowKey))
  return { rev: row ? row.rev : 0 }
}

export function resolveExpect(db, scope, target) {
  return runStorageTransaction(db, EXPECT_STORES, 'readonly', tx => resolveExpectInTransaction(tx, scope, target))
}

export function createOperationsInTransaction(tx, scope, inputs, {
  randomUUID = () => globalThis.crypto.randomUUID(),
  now = Date.now,
} = {}) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const [accountId, classId] = classKey(scope)
    await requireCreatedOrPendingClass(tx, scope)
    if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('至少需要一筆操作')

    const counters = tx.objectStore('queueCounters')
    const counter = await requestResult(counters.get([accountId, classId]))
    let sequence = counter?.lastSeq ?? 0
    const queue = tx.objectStore(QUEUE_STORE)
    const relations = tx.objectStore('queuedTargets')
    const saved = []
    let batchId = null
    for (const { type, payload, expect, expectTarget, targets = [] } of inputs) {
      const opId = randomUUID()
      if (typeof opId !== 'string' || !UUID_V4.test(opId)) throw new TypeError('操作編號須為第 4 版小寫 UUID')
      if (inputs.length > 1) batchId ??= opId
      const createdAt = now()
      const operation = {
        accountId, classId, op_id: opId, v: 1, batch_id: batchId, client_seq: ++sequence,
        createdAt, client_time: new Date(createdAt).toISOString(), type, payload: structuredClone(payload),
        status: 'queued',
      }
      if (expect === 'auto') {
        operation.expect = await resolveExpectInTransaction(tx, scope, expectTarget)
      } else if (expect !== undefined) {
        operation.expect = structuredClone(expect)
      }
      await requestResult(queue.add(operation))
      // 同一筆操作可以重複宣告同一列，該列只需要一筆關聯。
      for (const { entity, key } of targets) {
        await requestResult(relations.put({
          accountId, classId, entity, entityKey: serializeEntityKey(key),
          client_seq: sequence, op_id: opId,
        }))
      }
      saved.push(operation)
    }
    await requestResult(counters.put({ accountId, classId, lastSeq: sequence }))
    return saved
  })
}

export function createOperations(db, scope, inputs, options) {
  return runStorageTransaction(db, CREATE_STORES, 'readwrite', tx =>
    createOperationsInTransaction(tx, scope, inputs, options),
  )
}

export async function listOperationsInTransaction(tx, scope) {
  const operations = await requestResult(tx.objectStore(QUEUE_STORE).index('byClass').getAll(classKey(scope)))
  return operations.sort((left, right) => left.client_seq - right.client_seq)
}

export function listOperations(db, scope) {
  return runStorageTransaction(db, QUEUE_STORE, 'readonly', tx => listOperationsInTransaction(tx, scope))
}

export async function countOtherAccountsInTransaction(tx, accountId) {
  const queue = tx.objectStore(QUEUE_STORE)
  const [all, own] = await Promise.all([
    requestResult(queue.count()),
    requestResult(queue.index('byAccount').count(accountId)),
  ])
  return all - own
}

export function countOtherAccounts(db, accountId) {
  return runStorageTransaction(db, QUEUE_STORE, 'readonly', tx => countOtherAccountsInTransaction(tx, accountId))
}

function belongsToScope(operation, { accountId, classId }) {
  return operation?.accountId === accountId && operation?.classId === classId
}

export function updateOperationInTransaction(tx, scope, opId, patch) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const fields = Object.entries(patch)
    for (const [field, value] of fields) {
      if (!SEND_FIELDS.includes(field)) throw new TypeError(`不得更新待送操作欄位 ${field}`)
      if (field === 'status' && !QUEUE_STATUSES.includes(value)) throw new TypeError('待送操作狀態無效')
    }
    const queue = tx.objectStore(QUEUE_STORE)
    const operation = await requestResult(queue.get(opId))
    if (!operation || !belongsToScope(operation, scope)) return undefined
    const updated = { ...operation, ...Object.fromEntries(fields) }
    await requestResult(queue.put(updated))
    return updated
  })
}

export function updateOperation(db, scope, opId, patch) {
  return runStorageTransaction(db, [LOGIN_STORE, QUEUE_STORE], 'readwrite', tx =>
    updateOperationInTransaction(tx, scope, opId, patch),
  )
}

async function putNeedsAttention(tx, scope, operation, details) {
  if (!operation || !belongsToScope(operation, scope)) {
    throw new StorageError('OPERATION_SCOPE_MISMATCH', '原操作與需要處理的帳號或班級不符')
  }
  const [accountId, classId] = classKey(scope)
  const item = { ...details, accountId, classId, op_id: operation.op_id, operation }
  await requestResult(tx.objectStore(ATTENTION_STORE).put(item))
}

export function saveNeedsAttentionInTransaction(tx, scope, operation, details) {
  return writeClassDataInTransaction(tx, scope, () => putNeedsAttention(tx, scope, operation, details))
}

export function saveNeedsAttention(db, scope, operation, details) {
  return runStorageTransaction(db, [LOGIN_STORE, ATTENTION_STORE], 'readwrite', tx =>
    saveNeedsAttentionInTransaction(tx, scope, operation, details),
  )
}

export function listNeedsAttentionInTransaction(tx, scope) {
  return requestResult(tx.objectStore(ATTENTION_STORE).index('byClass').getAll(classKey(scope)))
}

export function listNeedsAttention(db, scope) {
  return runStorageTransaction(db, ATTENTION_STORE, 'readonly', tx => listNeedsAttentionInTransaction(tx, scope))
}

export function deleteNeedsAttentionInTransaction(tx, scope, opId) {
  return writeClassDataInTransaction(tx, scope, () =>
    requestResult(tx.objectStore(ATTENTION_STORE).delete([...classKey(scope), opId])),
  )
}

export function deleteNeedsAttention(db, scope, opId) {
  return runStorageTransaction(db, [LOGIN_STORE, ATTENTION_STORE], 'readwrite', tx =>
    deleteNeedsAttentionInTransaction(tx, scope, opId),
  )
}

export function removeOperationInTransaction(tx, scope, opId, attention) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const queue = tx.objectStore(QUEUE_STORE)
    const operation = await requestResult(queue.get(opId))
    if (!operation || !belongsToScope(operation, scope)) return undefined
    if (attention !== undefined) await putNeedsAttention(tx, scope, operation, attention)
    const relations = tx.objectStore('queuedTargets')
    const keys = await requestResult(relations.index('byOperation').getAllKeys(opId))
    for (const key of keys) await requestResult(relations.delete(key))
    await requestResult(queue.delete(opId))
    return operation
  })
}

export function removeOperation(db, scope, opId, attention) {
  const stores = [LOGIN_STORE, QUEUE_STORE, 'queuedTargets']
  if (attention !== undefined) stores.push(ATTENTION_STORE)
  return runStorageTransaction(db, stores, 'readwrite', tx => removeOperationInTransaction(tx, scope, opId, attention))
}

export function saveDraftInTransaction(tx, scope, draftId, draft) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const [accountId, classId] = classKey(scope)
    await requireCreatedOrPendingClass(tx, scope)
    await requestResult(tx.objectStore(DRAFT_STORE).put({ accountId, classId, draftId, draft }))
  })
}

export function saveDraft(db, scope, draftId, draft) {
  return runStorageTransaction(db, [LOGIN_STORE, CLASS_STATE_STORE, DRAFT_STORE], 'readwrite', tx =>
    saveDraftInTransaction(tx, scope, draftId, draft),
  )
}

export async function getDraftInTransaction(tx, scope, draftId) {
  const record = await requestResult(tx.objectStore(DRAFT_STORE).get([...classKey(scope), draftId]))
  return record?.draft
}

export function getDraft(db, scope, draftId) {
  return runStorageTransaction(db, DRAFT_STORE, 'readonly', tx => getDraftInTransaction(tx, scope, draftId))
}

export function deleteDraftInTransaction(tx, scope, draftId) {
  return writeClassDataInTransaction(tx, scope, () =>
    requestResult(tx.objectStore(DRAFT_STORE).delete([...classKey(scope), draftId])),
  )
}

export function deleteDraft(db, scope, draftId) {
  return runStorageTransaction(db, [LOGIN_STORE, DRAFT_STORE], 'readwrite', tx =>
    deleteDraftInTransaction(tx, scope, draftId),
  )
}

export function saveLocalLoginInTransaction(tx, login) {
  return writeInTransaction(tx, async () => {
    if (typeof login?.accountId !== 'string' || !login.accountId) throw new TypeError('登入紀錄需要帳號識別值')
    await requestResult(tx.objectStore(LOGIN_STORE).put(login, 'current'))
  })
}

export function saveLocalLogin(db, login) {
  return runStorageTransaction(db, LOGIN_STORE, 'readwrite', tx => saveLocalLoginInTransaction(tx, login))
}

export function deleteLocalLoginInTransaction(tx) {
  return writeInTransaction(tx, () => requestResult(tx.objectStore(LOGIN_STORE).delete('current')))
}

export function deleteLocalLogin(db) {
  return runStorageTransaction(db, LOGIN_STORE, 'readwrite', deleteLocalLoginInTransaction)
}

export function getDeviceSettingInTransaction(tx, name) {
  return requestResult(tx.objectStore(DEVICE_SETTINGS_STORE).get(name))
}

export function getDeviceSetting(db, name) {
  return runStorageTransaction(db, DEVICE_SETTINGS_STORE, 'readonly', tx => getDeviceSettingInTransaction(tx, name))
}

export function saveDeviceSettingInTransaction(tx, name, value) {
  return writeInTransaction(tx, async () => {
    await requestResult(tx.objectStore(DEVICE_SETTINGS_STORE).put(value, name))
  })
}

export function saveDeviceSetting(db, name, value) {
  return runStorageTransaction(db, DEVICE_SETTINGS_STORE, 'readwrite', tx => saveDeviceSettingInTransaction(tx, name, value))
}

export function getAccountSettingInTransaction(tx, accountId, name) {
  return requestResult(tx.objectStore(ACCOUNT_SETTINGS_STORE).get([accountId, name]))
}

export function getAccountSetting(db, accountId, name) {
  return runStorageTransaction(db, ACCOUNT_SETTINGS_STORE, 'readonly', tx => getAccountSettingInTransaction(tx, accountId, name))
}

export function saveAccountSettingInTransaction(tx, accountId, name, value) {
  return writeInTransaction(tx, async () => {
    await requestResult(tx.objectStore(ACCOUNT_SETTINGS_STORE).put(value, [accountId, name]))
  })
}

export function saveAccountSetting(db, accountId, name, value) {
  return runStorageTransaction(db, ACCOUNT_SETTINGS_STORE, 'readwrite', tx =>
    saveAccountSettingInTransaction(tx, accountId, name, value),
  )
}

export function saveClassStateInTransaction(tx, scope, patch) {
  return writeClassDataInTransaction(tx, scope, async () => {
    const [accountId, classId] = classKey(scope)
    const current = await getClassStateInTransaction(tx, scope)
    const state = { ...current, ...patch, accountId, classId }
    if (typeof state.notCreated !== 'boolean') throw new TypeError('沒有建成標記須為布林值')
    for (const sequence of [state.seenSeq, state.appliedSeq]) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('班級序號須為非負整數')
    }
    await requestResult(tx.objectStore(CLASS_STATE_STORE).put(state))
    return state
  })
}

export function saveClassState(db, scope, patch) {
  return runStorageTransaction(db, [LOGIN_STORE, CLASS_STATE_STORE], 'readwrite', tx =>
    saveClassStateInTransaction(tx, scope, patch),
  )
}
