// IndexedDB 的最小包裝：開庫、寫一筆、讀一筆。
// 資料庫工廠由呼叫端注入（瀏覽器傳 window.indexedDB，測試傳 fake-indexeddb 的 IDBFactory），
// 方便單元測試各自用獨立的資料庫。正式資料模型與交易規則由存放層的施工包另定。

export async function openDatabase({ factory, name, version, upgrade } = {}) {
  if (!factory || typeof factory.open !== 'function') throw new TypeError('openDatabase 需要 factory（IndexedDB 工廠）')
  if (typeof name !== 'string' || !name) throw new TypeError('openDatabase 需要非空字串 name')
  if (!Number.isInteger(version) || version < 1) throw new TypeError('openDatabase 需要正整數 version')
  if (typeof upgrade !== 'function') throw new TypeError('openDatabase 需要 upgrade 函式')

  const request = factory.open(name, version)
  request.onupgradeneeded = event => {
    upgrade(request.result, event.oldVersion, request.transaction)
  }
  const db = await requestResult(request)
  // 別的分頁要升版時先讓出連線，避免對方一直卡在 blocked。
  db.onversionchange = () => db.close()
  return db
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
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 交易已中止'))
  })
}
