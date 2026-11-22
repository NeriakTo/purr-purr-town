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

  it('參數不對時直接拒絕', async () => {
    await expect(openDatabase({ name: DB_NAME, version: 1, upgrade: () => {} })).rejects.toThrow('factory')
    await expect(openDatabase({ factory, name: '', version: 1, upgrade: () => {} })).rejects.toThrow('name')
    await expect(openDatabase({ factory, name: DB_NAME, version: 0, upgrade: () => {} })).rejects.toThrow('version')
    await expect(openDatabase({ factory, name: DB_NAME, version: 1 })).rejects.toThrow('upgrade')
  })
})
