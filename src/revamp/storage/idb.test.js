import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRecord, openDatabase, putRecord } from './idb.js'

// 示範用的暫存資料庫，不是新版的正式資料模型（那由存放層的施工包定）。
const DB_NAME = 'scaffold-demo'
const STORE = 'records'

function openDemo(factory) {
  return openDatabase({
    factory,
    name: DB_NAME,
    version: 1,
    upgrade: db => db.createObjectStore(STORE, { keyPath: 'id' }),
  })
}

describe('IndexedDB 小工具', () => {
  let factory

  beforeEach(() => {
    factory = new IDBFactory()
  })

  it('開資料庫、寫一筆、讀回', async () => {
    const db = await openDemo(factory)
    await putRecord(db, STORE, { id: 'demo-1', label: '假資料一號' })
    expect(await getRecord(db, STORE, 'demo-1')).toEqual({ id: 'demo-1', label: '假資料一號' })
    db.close()
  })

  it('關掉連線再重開，寫入的資料還在', async () => {
    const first = await openDemo(factory)
    await putRecord(first, STORE, { id: 'demo-2', label: '假資料二號' })
    first.close()

    const second = await openDemo(factory)
    expect(await getRecord(second, STORE, 'demo-2')).toEqual({ id: 'demo-2', label: '假資料二號' })
    second.close()
  })

  it('讀不存在的鍵回 undefined', async () => {
    const db = await openDemo(factory)
    expect(await getRecord(db, STORE, 'missing')).toBeUndefined()
    db.close()
  })

  it('寫入失敗時呼叫端拿到失敗，資料庫裡沒有留下', async () => {
    const db = await openDemo(factory)
    await expect(putRecord(db, STORE, { label: '缺少 id' })).rejects.toThrow()
    await expect(putRecord(db, 'no-such-store', { id: 'x' })).rejects.toThrow()
    expect(await getRecord(db, STORE, 'x')).toBeUndefined()
    db.close()
  })

  it('寫入請求非同步失敗時，呼叫端拿到的是錯誤物件而不是 null', async () => {
    const db = await openDatabase({
      factory,
      name: 'scaffold-demo-unique',
      version: 1,
      upgrade: database => database.createObjectStore(STORE, { keyPath: 'id' }).createIndex('byCode', 'code', { unique: true }),
    })
    await putRecord(db, STORE, { id: 'a', code: 'same' })
    await expect(putRecord(db, STORE, { id: 'b', code: 'same' })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await getRecord(db, STORE, 'b')).toBeUndefined()
    db.close()
  })

  it('開資料庫被舊連線擋住時，呼叫端拿到明確的失敗，不會一直等；之後也不會在背後升版', async () => {
    // 模擬別的分頁用舊程式開著第 1 版、沒有在 versionchange 時讓出連線
    const old = await openDemo(factory)
    old.onversionchange = null
    const upgrades = []
    const opening = openDatabase({ factory, name: DB_NAME, version: 2, upgrade: () => upgrades.push('升版') })
    const outcome = await Promise.race([
      opening.then(() => '開成功', error => error),
      new Promise(resolve => setTimeout(() => resolve('一秒後仍在等'), 1000)),
    ])
    expect(outcome).toMatchObject({ name: 'DatabaseBlockedError' })
    expect(outcome.message).toContain(DB_NAME)

    // 舊連線關掉後，已經回報失敗的那次開啟不會再自己升版、也不會留下沒人關的連線
    old.close()
    const reopened = await openDemo(factory)
    expect(reopened.version).toBe(1)
    expect(upgrades).toEqual([])
    reopened.close()
    const upgraded = await openDatabase({ factory, name: DB_NAME, version: 2, upgrade: () => upgrades.push('升版') })
    expect(upgraded.version).toBe(2)
    expect(upgrades).toEqual(['升版'])
    upgraded.close()
  })

  it('寫入失敗後中止交易又丟例外時，呼叫端拿到的仍是原本的錯', async () => {
    // 交易已不在可中止的狀態時 abort() 會丟 InvalidStateError；這裡用假的交易物件重現
    const original = new Error('原本的寫入錯誤')
    const transaction = {
      objectStore: () => ({ put: () => { throw original } }),
      abort: () => { throw new DOMException('交易已結束', 'InvalidStateError') },
    }
    const db = { transaction: () => transaction }
    const outcome = await Promise.race([
      putRecord(db, STORE, { id: 'x' }).then(() => '寫入成功', error => error),
      new Promise(resolve => setTimeout(() => resolve('一秒後仍在等'), 1000)),
    ])
    expect(outcome).toBe(original)
  })

  it('讀取請求成功但交易之後被中止時，呼叫端拿到失敗', async () => {
    const db = await openDemo(factory)
    await putRecord(db, STORE, { id: 'demo-3', label: '假資料三號' })
    // 包一層：讀取請求成功的當下中止同一個交易，模擬交易層在請求之後才失敗
    const abortingDb = {
      transaction: (...args) => {
        const transaction = db.transaction(...args)
        const objectStore = transaction.objectStore.bind(transaction)
        transaction.objectStore = name => {
          const store = objectStore(name)
          const get = store.get.bind(store)
          store.get = key => {
            const request = get(key)
            request.addEventListener('success', () => transaction.abort())
            return request
          }
          return store
        }
        return transaction
      },
    }
    await expect(getRecord(abortingDb, STORE, 'demo-3')).rejects.toThrow()
    expect(await getRecord(db, STORE, 'demo-3')).toEqual({ id: 'demo-3', label: '假資料三號' })
    db.close()
  })

  it('參數不對時直接拒絕', async () => {
    await expect(openDatabase({ name: DB_NAME, version: 1, upgrade: () => {} })).rejects.toThrow('factory')
    await expect(openDatabase({ factory, name: '', version: 1, upgrade: () => {} })).rejects.toThrow('name')
    await expect(openDatabase({ factory, name: DB_NAME, version: 0, upgrade: () => {} })).rejects.toThrow('version')
    await expect(openDatabase({ factory, name: DB_NAME, version: 1 })).rejects.toThrow('upgrade')
  })
})
