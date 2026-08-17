import { getMeta, setMeta } from './storage.js'
import { setSyncStatus, markConflict, hasConflict } from './syncStatus.js'

const SYNC_DEBOUNCE_MS = 3000
const MAX_RETRY = 3
const RETRY_BACKOFF_MS = 2000

let apiUrl = null
let authToken = null
let debounceTimers = {}
let retryTimers = {}
let syncVersion = {}
let pendingPush = {} // classId -> 最新待送 payload（永遠合併為最新）
let pushInFlight = {} // classId -> 進行中的推送迴圈 Promise（單飛，防並行）
let retryWakers = {} // classId -> 退避 sleep 的 resolve（取消退避時喚醒迴圈，避免永久卡 await）

export function getSyncApiUrl() {
  if (apiUrl) return apiUrl
  apiUrl = import.meta.env.VITE_SYNC_API_URL || ''
  return apiUrl
}

export function isSyncEnabled() {
  return !!getSyncApiUrl() && !!authToken
}

export function setSyncToken(token) {
  authToken = token
}

export function getSyncToken() {
  return authToken
}

async function fetchApi(path, options = {}) {
  const base = getSyncApiUrl()
  if (!base) return null

  const url = `${base}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers
  }

  let res
  try {
    res = await fetch(url, { ...options, headers })
  } catch (netErr) {
    // fetch 本身失敗＝網路層問題，標記為可重試的網路錯誤
    const err = new Error(netErr?.message || '網路連線失敗')
    err.status = 0
    err.isNetwork = true
    throw err
  }

  let json
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (!res.ok) {
    // 401：憑證失效——集中處理，清除本機 token 並把全域狀態切成「已過期」。
    // 這是根治假連線的關鍵：任何一支 API 撞到 401 都會讓畫面立刻反映真相。
    if (res.status === 401) {
      authToken = null
      setSyncStatus('expired')
      // 清本機 token 為 best-effort：即使 IndexedDB 寫入失敗，也不可讓例外蓋掉
      // 上面已定調的 expired 狀態（否則會被外層 catch 誤判成 offline）。
      try { await setMeta('sync_token', null) } catch { /* 清除失敗不影響 expired 判定 */ }
    }
    const err = new Error(json.error || `HTTP ${res.status}`)
    err.status = res.status
    err.serverVersion = json.serverVersion
    throw err
  }

  return json
}

// 是否為「值得退避重試」的錯誤：只有網路層、408、429、5xx。
// 401（失效）、400（請求錯）、403（無權）都是重試也不會好的，直接放棄。
function isRetryable(err) {
  if (err?.isNetwork || err?.status === 0) return true
  const s = err?.status || 0
  return s === 408 || s === 429 || s >= 500
}

// --- Auth API ---

export async function register(name, passcode) {
  const res = await fetchApi('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, passcode })
  })
  if (res?.success) {
    authToken = res.data.token
    await setMeta('sync_token', authToken)
    await setMeta('teacher_id', res.data.teacherId)
    await setMeta('teacher_name', res.data.name)
    setSyncStatus('connected')
  }
  return res
}

export async function login(name, passcode) {
  const res = await fetchApi('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ name, passcode })
  })
  if (res?.success) {
    authToken = res.data.token
    await setMeta('sync_token', authToken)
    await setMeta('teacher_id', res.data.teacherId)
    await setMeta('teacher_name', res.data.name)
    setSyncStatus('connected')
  }
  return res
}

export async function logout() {
  authToken = null
  setSyncStatus('disconnected')
  // Cancel all pending debounce timers
  Object.keys(debounceTimers).forEach(id => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]
  })
  // Cancel all pending retry timers，並喚醒正在退避 sleep 的推送迴圈——
  // 只 clearTimeout 而不 resolve 會讓迴圈永遠卡在 await，finally 不執行、
  // pushInFlight 永久鎖死該班後續推送（黑喵 R3 BLOCKING）。喚醒後迴圈頂端
  // 檢查 authToken 已為 null 即會退出並清鎖。
  Object.keys(retryTimers).forEach(id => {
    clearTimeout(retryTimers[id])
    delete retryTimers[id]
  })
  Object.keys(retryWakers).forEach(id => {
    const wake = retryWakers[id]
    delete retryWakers[id]
    wake()
  })
  await setMeta('sync_token', null)
  await setMeta('teacher_id', null)
  await setMeta('teacher_name', null)
}

// 還原本機記住的 token（僅設進記憶體，不代表已連線）。
// 真正的連線判定改由 validateSession() 向伺服器確認。
export async function restoreSession() {
  const token = await getMeta('sync_token')
  if (token) {
    authToken = token
    return true
  }
  return false
}

// 向伺服器確認憑證是否仍有效。這是根治假連線的地基：
// 開機時呼叫一次，有效→connected、失效→expired（並清 token）、連不上→offline。
// 回傳 { valid, name, expiresAt } 或 null（未持有 token）。
export async function validateSession() {
  const token = authToken || (await getMeta('sync_token'))
  if (!token) {
    setSyncStatus('disconnected')
    return null
  }
  authToken = token
  try {
    const res = await fetchApi('/auth/session')
    if (res?.success) {
      setSyncStatus('connected')
      return { valid: true, name: res.data.name, expiresAt: res.data.expiresAt }
    }
    return { valid: false }
  } catch (err) {
    if (err.status === 401) {
      // fetchApi 已清 token 並設 expired
      return { valid: false }
    }
    // 網路／伺服器暫時不可用：不要登出，維持可離線編輯
    setSyncStatus('offline')
    return { valid: true, offline: true }
  }
}

// --- Class sync ---

export async function syncClassToServer(classId, classMeta) {
  if (!isSyncEnabled()) return
  try {
    await fetchApi('/classes', {
      method: 'POST',
      body: JSON.stringify({
        id: classMeta.id,
        year: classMeta.year,
        name: classMeta.name,
        teacher: classMeta.teacher,
        alias: classMeta.alias,
        status: classMeta.status,
        studentCount: classMeta.studentCount
      })
    })
  } catch (err) {
    console.warn('班級同步失敗:', err.message)
  }
}

export async function fetchRemoteClasses() {
  if (!isSyncEnabled()) return null
  try {
    const res = await fetchApi('/classes')
    return res?.success ? res.data : null
  } catch {
    return null
  }
}

export async function deleteRemoteClass(classId) {
  if (!isSyncEnabled()) return
  try {
    await fetchApi(`/classes/${classId}`, { method: 'DELETE' })
  } catch (err) {
    console.warn('遠端班級刪除失敗:', err.message)
  }
}

// --- Ensure class exists on server ---

async function ensureClassOnServer(classId) {
  try {
    const lsRaw = localStorage.getItem('ppt_local_classes')
    const classes = lsRaw ? JSON.parse(lsRaw) : []
    const classMeta = classes.find(c => c.id === classId)
    if (classMeta) {
      await syncClassToServer(classId, classMeta)
    } else {
      await fetchApi('/classes', {
        method: 'POST',
        body: JSON.stringify({ id: classId, name: classId, status: 'active', studentCount: 0 })
      })
    }
  } catch (err) {
    console.warn('確保班級存在失敗:', err.message)
  }
}

// --- 單班單飛推送核心 ---
// 每班同時只有一個推送迴圈在跑；pendingPush[classId] 永遠是最新待送 payload。
// 這樣 debounce、retry、online 重送三條路徑都併入同一條序列，不會並行送同版本
// 而互相 409（自我衝突），也不會讓舊 payload 搶先覆蓋新資料。

// 啟動或喚醒某班的推送迴圈（idempotent：已在跑就不重複啟）。
function kickPush(classId) {
  if (!authToken || hasConflict(classId)) return
  if (pushInFlight[classId]) return
  if (pendingPush[classId] === undefined) return
  const p = runPushLoop(classId).finally(() => { delete pushInFlight[classId] })
  pushInFlight[classId] = p
}

// 測試用：目前有推送迴圈在跑的班級（驗證單飛鎖有無正確釋放）
export function __getPushInFlightKeys() {
  return Object.keys(pushInFlight)
}

async function runPushLoop(classId) {
  let retryCount = 0
  while (true) {
    if (!authToken || hasConflict(classId)) return
    const payload = pendingPush[classId]
    if (payload === undefined) return

    try {
      const version = syncVersion[classId] || 0
      const res = await fetchApi(`/snapshots/${classId}`, {
        method: 'PUT',
        body: JSON.stringify({ payload, version })
      })
      if (res?.success) {
        syncVersion[classId] = res.data.version
        await setMeta(`sync_version_${classId}`, res.data.version)
        setSyncStatus('connected')
        // 飛行期間 payload 未被更新才清除；被新編輯取代則保留最新、續送。
        if (pendingPush[classId] === payload) { delete pendingPush[classId]; return }
        retryCount = 0
        continue
      }
      return
    } catch (err) {
      // 401：憑證失效。fetchApi 已清 token 並設 expired。停止，不重試。
      if (err.status === 401) return

      // 409：伺服器已有更新的資料。標記衝突交人工決策；不推進版本（見 Dashboard 解衝突流程）。
      if (err.status === 409) { markConflict(classId); return }

      // 403：多半是這個班還沒建到伺服器上（自己的新班），建好重試一次。
      if (err.status === 403) {
        await ensureClassOnServer(classId)
        if (retryCount === 0) { retryCount = 1; continue }
        return
      }

      // 可重試（網路／408／429／5xx）：退避後續送同一迴圈；pendingPush 保留。
      if (isRetryable(err)) {
        setSyncStatus('offline')
        if (retryCount < MAX_RETRY) {
          const delay = RETRY_BACKOFF_MS * Math.pow(2, retryCount)
          // 記下 resolve，讓 logout 等取消動作能喚醒此 sleep（否則迴圈永久卡 await）。
          await new Promise(resolve => {
            retryWakers[classId] = resolve
            retryTimers[classId] = setTimeout(() => {
              delete retryTimers[classId]
              delete retryWakers[classId]
              resolve()
            }, delay)
          })
          delete retryWakers[classId]
          retryCount++
          continue
        }
        // 用盡重試：保留 pendingPush，等下次編輯或 online 事件再送
        console.warn('快照同步失敗（已重試 3 次），待恢復後自動重送:', err.message)
        return
      }
      return
    }
  }
}

// --- Snapshot sync (immediate, for manual push) ---

export async function pushSnapshotImmediate(classId, payload) {
  if (!isSyncEnabled()) return false
  if (hasConflict(classId)) {
    const e = new Error('版本衝突：請先重新整理處理衝突')
    e.status = 409
    throw e
  }
  // 走同一條單飛迴圈，避免與背景推送並行
  pendingPush[classId] = payload
  if (debounceTimers[classId]) { clearTimeout(debounceTimers[classId]); delete debounceTimers[classId] }
  kickPush(classId)
  await pushInFlight[classId]

  if (hasConflict(classId)) {
    const e = new Error('版本衝突：伺服器已有更新的資料')
    e.status = 409
    throw e
  }
  if (pendingPush[classId] !== undefined) {
    throw new Error('上傳失敗，請稍後再試')
  }
  return true
}

// --- Snapshot sync (debounced) ---

export function scheduleSyncSnapshot(classId, payload) {
  if (!isSyncEnabled()) return
  // 未解衝突期間暫停自動推送，避免用本機資料覆蓋另一裝置的更新。
  if (hasConflict(classId)) return

  // 立即記錄最新待送 payload（合併為最新），debounce 只延遲實際送出時機。
  pendingPush[classId] = payload
  if (debounceTimers[classId]) clearTimeout(debounceTimers[classId])
  debounceTimers[classId] = setTimeout(() => {
    delete debounceTimers[classId]
    kickPush(classId)
  }, SYNC_DEBOUNCE_MS)
}

// 網路恢復時喚醒所有待送班級的推送迴圈（單飛保證不並行）。
export async function flushPendingPushes() {
  for (const classId of Object.keys(pendingPush)) {
    kickPush(classId)
  }
}

// 瀏覽器回線時：先確認憑證仍有效，再喚醒待上傳的推送。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => {
    validateSession().then(r => {
      if (r?.valid && !r.offline) flushPendingPushes()
    })
  })
}

// 採用遠端資料時使用：讀遠端並把本機同步版本設為遠端版本（會持久化）。
// 用於「首次在新裝置同步」與「使用者明確選擇採用遠端／手動拉取」。
export async function pullSnapshot(classId) {
  if (!isSyncEnabled()) return null
  try {
    const res = await fetchApi(`/snapshots/${classId}`)
    if (res?.success && res.data) {
      syncVersion[classId] = res.data.version
      await setMeta(`sync_version_${classId}`, res.data.version)
      return res.data
    }
    return null
  } catch {
    return null
  }
}

// 衝突預覽用：只讀遠端資料，「不」改動本機同步版本。
// 關鍵：在使用者於選擇視窗做決定「之前」絕不可提交遠端版本為本機基準——
// 否則若視窗顯示期間重新整理或關閉，下次載入因版本已相等而跳過選擇，
// 舊本機資料會被自動上傳覆蓋遠端（黑喵覆審 BLOCKING 1）。
export async function pullSnapshotPreview(classId) {
  if (!isSyncEnabled()) return null
  try {
    const res = await fetchApi(`/snapshots/${classId}`)
    return res?.success && res.data ? res.data : null
  } catch {
    return null
  }
}

// 使用者在選擇視窗做出決定後，才提交本機同步版本基準。
// 採用遠端或保留本機都把基準設為遠端版本：下一次推送以此為 expected version，
// 保留本機時即以此明確覆蓋遠端。
export async function commitSyncVersion(classId, version) {
  syncVersion[classId] = version
  await setMeta(`sync_version_${classId}`, version)
}

export async function getRemoteVersion(classId) {
  if (!isSyncEnabled()) return null
  try {
    const res = await fetchApi(`/snapshots/${classId}/version`)
    return res?.success ? res.data : null
  } catch {
    return null
  }
}

export async function initSyncVersions(classIds) {
  for (const classId of classIds) {
    const v = await getMeta(`sync_version_${classId}`)
    if (v) syncVersion[classId] = v
  }
}

export function getLocalSyncVersion(classId) {
  return syncVersion[classId] || 0
}
