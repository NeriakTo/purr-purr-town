import { getMeta, setMeta } from './storage.js'

const SYNC_DEBOUNCE_MS = 3000
const MAX_RETRY = 3
const RETRY_BACKOFF_MS = 2000

let apiUrl = null
let authToken = null
let debounceTimers = {}
let retryTimers = {}
let syncVersion = {}

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

  const res = await fetch(url, { ...options, headers })

  let json
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`)
    err.status = res.status
    err.serverVersion = json.serverVersion
    throw err
  }

  return json
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
  }
  return res
}

export async function logout() {
  authToken = null
  // Cancel all pending debounce timers
  Object.keys(debounceTimers).forEach(id => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]
  })
  // Cancel all pending retry timers
  Object.keys(retryTimers).forEach(id => {
    clearTimeout(retryTimers[id])
    delete retryTimers[id]
  })
  await setMeta('sync_token', null)
  await setMeta('teacher_id', null)
  await setMeta('teacher_name', null)
}

export async function restoreSession() {
  const token = await getMeta('sync_token')
  if (token) {
    authToken = token
    return true
  }
  return false
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

// --- Snapshot sync (immediate, for manual push) ---

export async function pushSnapshotImmediate(classId, payload) {
  if (!isSyncEnabled()) return false
  try {
    const version = syncVersion[classId] || 0
    const res = await fetchApi(`/snapshots/${classId}`, {
      method: 'PUT',
      body: JSON.stringify({ payload, version })
    })
    if (res?.success) {
      syncVersion[classId] = res.data.version
      await setMeta(`sync_version_${classId}`, res.data.version)
      return true
    }
    return false
  } catch (err) {
    if (err.status === 409) {
      syncVersion[classId] = err.serverVersion
    }
    throw err
  }
}

// --- Snapshot sync (debounced) ---

export function scheduleSyncSnapshot(classId, payload) {
  if (!isSyncEnabled()) return

  if (debounceTimers[classId]) {
    clearTimeout(debounceTimers[classId])
  }
  // Cancel any pending retry for this class (new data supersedes old retry)
  if (retryTimers[classId]) {
    clearTimeout(retryTimers[classId])
    delete retryTimers[classId]
  }

  debounceTimers[classId] = setTimeout(() => {
    delete debounceTimers[classId]
    pushSnapshot(classId, payload)
  }, SYNC_DEBOUNCE_MS)
}

async function pushSnapshot(classId, payload, retryCount = 0) {
  if (!authToken) return

  try {
    const version = syncVersion[classId] || 0
    const res = await fetchApi(`/snapshots/${classId}`, {
      method: 'PUT',
      body: JSON.stringify({ payload, version })
    })
    if (res?.success) {
      syncVersion[classId] = res.data.version
      await setMeta(`sync_version_${classId}`, res.data.version)
    }
  } catch (err) {
    if (err.status === 403) {
      // Class doesn't exist on server yet — create it and retry
      await ensureClassOnServer(classId)
      if (retryCount === 0) {
        return pushSnapshot(classId, payload, retryCount + 1)
      }
    }
    if (err.status === 409) {
      syncVersion[classId] = err.serverVersion
      await setMeta(`sync_version_${classId}`, err.serverVersion)
      if (retryCount < 1) {
        return pushSnapshot(classId, payload, retryCount + 1)
      }
      return
    }
    if (!authToken) return
    if (retryCount < MAX_RETRY) {
      const delay = RETRY_BACKOFF_MS * Math.pow(2, retryCount)
      retryTimers[classId] = setTimeout(() => {
        delete retryTimers[classId]
        pushSnapshot(classId, payload, retryCount + 1)
      }, delay)
    } else {
      console.warn('快照同步失敗（已重試 3 次）:', err.message)
    }
  }
}

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
