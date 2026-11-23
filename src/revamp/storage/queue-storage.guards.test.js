import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  getDeviceSetting, openQueueDatabase, saveDraftInTransaction, serializeEntityKey,
} from './queue-storage.js'

it.each([
  ['TRANSACTION_SCOPE_MISMATCH', ['deviceSettings', 'checkInDrafts']],
  ['LOGIN_REQUIRED', ['deviceSettings', 'checkInDrafts', 'localLogin']],
])('呼叫端吃掉 %s 後自行開啟的交易仍回滾', async (code, stores) => {
  const db = await openQueueDatabase({ factory: new IDBFactory() })
  try {
    const tx = db.transaction(stores, 'readwrite')
    const outcome = new Promise(resolve => {
      tx.addEventListener('complete', () => resolve('complete'), { once: true })
      tx.addEventListener('abort', () => resolve('abort'), { once: true })
    })
    const request = tx.objectStore('deviceSettings').put('測試值', '測試設定')
    const error = await new Promise((resolve, reject) => {
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('success', async () => {
        try {
          await saveDraftInTransaction(tx, { accountId: '帳號甲', classId: '班級甲' }, '草稿甲', {})
          resolve(undefined)
        } catch (caught) {
          resolve(caught)
        }
      }, { once: true })
    })
    expect(error).toMatchObject({ code })
    expect(await outcome).toBe('abort')
    expect(await getDeviceSetting(db, '測試設定')).toBeUndefined()
  } finally {
    db.close()
  }
})

it('列鍵序列化保留自有的 __proto__ 欄位', () => {
  const key = serializeEntityKey(JSON.parse('{"__proto__":"x","a":1}'))
  expect(key).not.toBe(serializeEntityKey({ a: 1 }))
  expect(JSON.parse(key)).toHaveProperty('__proto__', 'x')
})

it('列鍵序列化涵蓋不可列舉的自有欄位', () => {
  const key = Object.defineProperty({ a: 1 }, 'b', { value: 2 })
  expect(serializeEntityKey(key)).toBe('{"a":1,"b":2}')
  expect(serializeEntityKey(key)).not.toBe(serializeEntityKey({ a: 1 }))
})
