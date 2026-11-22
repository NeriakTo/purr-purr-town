import { getRecord, openDatabase, putRecord } from '../../storage/idb.js'

// 測試入口的最小示範：在獨立的暫存資料庫寫一筆、讀一筆，用來驗證「關掉分頁重開資料還在」。
// 不碰新版的正式資料模型。
export const name = 'idbProbe'
export const PROBE_DB_NAME = 'ppt-revamp-test-probe'
const STORE = 'records'

export function create({ indexedDB }) {
  let opening
  const database = () => {
    opening ??= openDatabase({
      factory: indexedDB,
      name: PROBE_DB_NAME,
      version: 1,
      upgrade: db => db.createObjectStore(STORE, { keyPath: 'id' }),
    }).catch(error => {
      opening = undefined
      throw error
    })
    return opening
  }

  return Object.freeze({
    async put(record) {
      await putRecord(await database(), STORE, record)
    },
    async get(id) {
      return getRecord(await database(), STORE, id)
    },
  })
}
