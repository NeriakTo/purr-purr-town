// IndexedDB 的最小包裝：開庫、寫一筆、讀一筆。
// 資料庫工廠由呼叫端注入（瀏覽器傳 window.indexedDB，測試傳 fake-indexeddb 的 IDBFactory），
// 方便單元測試各自用獨立的資料庫。正式資料模型與交易規則由存放層的施工包另定。

export async function openDatabase({ factory, name, version, upgrade } = {}) {
  if (!factory || typeof factory.open !== 'function') throw new TypeError('openDatabase 需要 factory（IndexedDB 工廠）')
  if (typeof name !== 'string' || !name) throw new TypeError('openDatabase 需要非空字串 name')
  if (!Number.isInteger(version) || version < 1) throw new TypeError('openDatabase 需要正整數 version')
  if (typeof upgrade !== 'function') throw new TypeError('openDatabase 需要 upgrade 函式')

  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    let settled = false
    request.onupgradeneeded = event => {
      // 已經回報被擋住的這次開啟，等舊連線關掉後不在背後自己升版。
      if (settled) {
        request.transaction.abort()
        return
      }
      upgrade(request.result, event.oldVersion, request.transaction)
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    }
    request.onerror = event => {
      // 已回報失敗後被中止的升版也會走到這裡，不再重複回報，也不讓錯誤往外冒。
      event?.preventDefault?.()
      if (settled) return
      settled = true
      reject(request.error)
    }
    // 別的分頁還開著舊版連線且不讓出時，不會自己結束，直接告訴呼叫端。
    request.onblocked = event => {
      if (settled) return
      settled = true
      reject(new DatabaseBlockedError(name, event.oldVersion, event.newVersion ?? version))
    }
  })
  // 別的分頁要升版時先讓出連線，避免對方一直卡在 blocked。
  db.onversionchange = () => db.close()
  return db
}

export class DatabaseBlockedError extends Error {
  constructor(name, oldVersion, newVersion) {
    super(`資料庫 ${name} 要從第 ${oldVersion} 版升到第 ${newVersion} 版，但被其他分頁仍開著的連線擋住；請關閉其他分頁後重試`)
    this.name = 'DatabaseBlockedError'
  }
}

// 交易完成（complete）才算寫入成功；請求成功但交易之後中止時，呼叫端會拿到失敗。
export async function putRecord(db, storeName, value) {
  const transaction = db.transaction(storeName, 'readwrite', { durability: 'strict' })
  const done = transactionDone(transaction)
  try {
    transaction.objectStore(storeName).put(value)
  } catch (error) {
    transaction.abort()
    await done.catch(() => {})
    throw error
  }
  await done
}

export async function getRecord(db, storeName, key) {
  const transaction = db.transaction(storeName, 'readonly')
  return requestResult(transaction.objectStore(storeName).get(key))
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    // 請求失敗的事件冒泡到交易時，transaction.error 可能還沒填，先取請求本身的錯誤。
    transaction.onerror = event => reject(event.target?.error ?? transaction.error ?? new Error('IndexedDB 交易失敗'))
    transaction.onabort = event => reject(transaction.error ?? event.target?.error ?? new Error('IndexedDB 交易已中止'))
  })
}
