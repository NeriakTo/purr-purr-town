// 同步狀態單一真相：讓全域橫幅與設定頁共讀同一份狀態，取代「只看本機有沒有 token」的假連線。
//
// 四態：
//   disconnected：未登入（本機模式）
//   connected   ：憑證有效，同步中
//   expired     ：憑證過期或失效——必須重新登入，資料只在本機（紅色阻斷提示）
//   offline     ：暫時連不上伺服器（網路／5xx），憑證仍有效，有資料待上傳（黃色提示）
//
// 另外追蹤每班的「版本衝突」旗標：背景推送遇 409 時設起，提示老師手動處理，
// 不再自動覆蓋另一裝置的資料。

const VALID = ['disconnected', 'connected', 'expired', 'offline']

let state = 'disconnected'
const conflicts = new Set() // classId 集合
const listeners = new Set()

function emit() {
  const snapshot = { status: state, conflicts: [...conflicts] }
  for (const fn of listeners) {
    try { fn(snapshot) } catch { /* 監聽者自身錯誤不影響其他人 */ }
  }
}

export function getSyncStatus() {
  return { status: state, conflicts: [...conflicts] }
}

export function setSyncStatus(next) {
  if (!VALID.includes(next)) return
  if (state === next) return
  state = next
  // 登出或過期時清掉衝突旗標（已無同步基準可談衝突）
  if (next === 'disconnected' || next === 'expired') conflicts.clear()
  emit()
}

export function hasConflict(classId) {
  return conflicts.has(classId)
}

export function markConflict(classId) {
  if (!classId || conflicts.has(classId)) return
  conflicts.add(classId)
  emit()
}

export function clearConflict(classId) {
  if (!classId || !conflicts.has(classId)) return
  conflicts.delete(classId)
  emit()
}

export function subscribeSyncStatus(fn) {
  listeners.add(fn)
  fn(getSyncStatus())
  return () => listeners.delete(fn)
}

// 測試用：重置模組狀態
export function __resetSyncStatus() {
  state = 'disconnected'
  conflicts.clear()
  listeners.clear()
}
