const DB_NAME = 'purr-purr-town'
const DB_VERSION = 1
const STORE_NAME = 'class_cache'
const META_STORE = 'meta'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })
  return dbPromise
}

async function getFromStore(storeName, key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function putToStore(storeName, key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function deleteFromStore(storeName, key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function getAllKeys(storeName) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// --- Public API ---

// 向瀏覽器申請持久儲存，避免資料在磁碟不足或長期未造訪時被自動回收。
// 這是同步失效期間本機資料唯一的保命符。回傳是否已取得持久化。
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch (err) {
    console.error('申請持久儲存失敗:', err)
    return false
  }
}

// 估算目前儲存用量與配額（供容量預警）。回傳 { usage, quota, ratio } 或 null。
export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 }
  } catch {
    return null
  }
}

export async function loadClassCacheIDB(classId) {
  if (!classId) return null
  try {
    return await getFromStore(STORE_NAME, classId)
  } catch (err) {
    console.error('IDB 讀取失敗，回退 localStorage:', err)
    return null
  }
}

export async function saveClassCacheIDB(classId, payload) {
  if (!classId || !payload) return
  try {
    await putToStore(STORE_NAME, classId, payload)
  } catch (err) {
    console.error('IDB 寫入失敗:', err)
  }
}

export async function deleteClassCacheIDB(classId) {
  if (!classId) return
  try {
    await deleteFromStore(STORE_NAME, classId)
  } catch (err) {
    console.error('IDB 刪除失敗:', err)
  }
}

export async function loadLocalClassesIDB() {
  try {
    const result = await getFromStore(META_STORE, 'local_classes')
    return result || []
  } catch {
    return []
  }
}

export async function saveLocalClassesIDB(classes) {
  try {
    await putToStore(META_STORE, 'local_classes', classes)
  } catch (err) {
    console.error('IDB 班級清單寫入失敗:', err)
  }
}

export async function getMeta(key) {
  return getFromStore(META_STORE, key)
}

export async function setMeta(key, value) {
  return putToStore(META_STORE, key, value)
}

export async function deleteMeta(key) {
  return deleteFromStore(META_STORE, key)
}

export async function migrateFromLocalStorage() {
  const lsClassesKey = 'ppt_local_classes'
  const raw = localStorage.getItem(lsClassesKey)
  if (!raw) return false

  try {
    const classes = JSON.parse(raw)
    if (!Array.isArray(classes) || classes.length === 0) return false

    await saveLocalClassesIDB(classes)

    for (const cls of classes) {
      const cacheKey = `ppt_cache_class_${cls.id}`
      const cacheRaw = localStorage.getItem(cacheKey)
      if (cacheRaw) {
        const cache = JSON.parse(cacheRaw)
        await saveClassCacheIDB(cls.id, cache)
      }
    }

    await setMeta('migrated_from_ls', new Date().toISOString())
    return true
  } catch (err) {
    console.error('localStorage 遷移失敗:', err)
    return false
  }
}
