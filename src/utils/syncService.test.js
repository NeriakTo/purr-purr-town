import { describe, it, expect, beforeEach, vi } from 'vitest'

// 記憶體 meta，替換 IndexedDB
const meta = new Map()
vi.mock('./storage.js', () => ({
  getMeta: async (k) => (meta.has(k) ? meta.get(k) : null),
  setMeta: async (k, v) => { meta.set(k, v) },
}))

vi.stubEnv('VITE_SYNC_API_URL', 'http://test/api')

const {
  setSyncToken, validateSession, pushSnapshotImmediate, scheduleSyncSnapshot,
  pullSnapshotPreview, commitSyncVersion, getLocalSyncVersion,
  logout, __getPushInFlightKeys,
} = await import('./syncService.js')
const { getSyncStatus, hasConflict, __resetSyncStatus } = await import('./syncStatus.js')

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('syncService 憑證與衝突處理', () => {
  beforeEach(() => {
    meta.clear()
    __resetSyncStatus()
    vi.restoreAllMocks()
    setSyncToken('tok')
  })

  it('401 讓狀態變 expired 並清除本機 token', async () => {
    global.fetch = vi.fn().mockResolvedValue(res(401, { error: 'Token 無效或已過期' }))
    const out = await validateSession()
    expect(out.valid).toBe(false)
    expect(getSyncStatus().status).toBe('expired')
    expect(meta.get('sync_token')).toBe(null)
  })

  it('憑證有效時狀態為 connected', async () => {
    global.fetch = vi.fn().mockResolvedValue(res(200, { success: true, data: { teacherId: 'A', name: 'feon', expiresAt: null } }))
    const out = await validateSession()
    expect(out.valid).toBe(true)
    expect(getSyncStatus().status).toBe('connected')
  })

  it('連不上伺服器時狀態為 offline，不登出', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const out = await validateSession()
    expect(out.valid).toBe(true)
    expect(out.offline).toBe(true)
    expect(getSyncStatus().status).toBe('offline')
    expect(meta.get('sync_token')).toBeUndefined() // 未被清除
  })

  it('推送遇 409：標記衝突並拋出，不自動覆蓋（不再次 fetch）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(409, { error: '版本衝突', serverVersion: 7 }))
    global.fetch = fetchMock
    await expect(pushSnapshotImmediate('c1', { students: [] })).rejects.toThrow()
    expect(getSyncStatus().conflicts).toContain('c1')
    expect(fetchMock).toHaveBeenCalledTimes(1) // 只呼叫一次，沒有自動重推覆蓋
  })

  it('409 後不推進本機版本號，且後續背景推送被閘門擋住（防下一次編輯覆蓋遠端）', async () => {
    // 先觸發一次 409，標記 c1 衝突
    global.fetch = vi.fn().mockResolvedValue(res(409, { error: '版本衝突', serverVersion: 7 }))
    await expect(pushSnapshotImmediate('c1', { students: [] })).rejects.toThrow()
    expect(hasConflict('c1')).toBe(true)

    // 接著模擬老師繼續編輯 → scheduleSyncSnapshot 應直接被擋，不發任何請求
    const fetchMock = vi.fn().mockResolvedValue(res(200, { success: true, data: { version: 99 } }))
    global.fetch = fetchMock
    scheduleSyncSnapshot('c1', { students: [{ id: 's1' }] })
    // 等一個 debounce 週期以上
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock).not.toHaveBeenCalled() // 衝突未解前不推送，遠端不被覆蓋
  })

  it('推送成功回 true 並將狀態設為 connected', async () => {
    global.fetch = vi.fn().mockResolvedValue(res(200, { success: true, data: { version: 3 } }))
    const ok = await pushSnapshotImmediate('c1', { students: [] })
    expect(ok).toBe(true)
    expect(getSyncStatus().status).toBe('connected')
  })

  it('同班並行推送單飛序列化，不會自我 409', async () => {
    let v = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      v++
      return res(200, { success: true, data: { version: v } })
    })
    const [a, b] = await Promise.all([
      pushSnapshotImmediate('c1', { students: [{ id: 's1' }] }),
      pushSnapshotImmediate('c1', { students: [{ id: 's2' }] }),
    ])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(getSyncStatus().conflicts).not.toContain('c1') // 沒有把自己的並行請求誤判成衝突
  })

  it('退避 sleep 期間登出會喚醒迴圈並釋放單飛鎖（不永久卡死）', async () => {
    vi.useFakeTimers()
    try {
      // 讓推送持續網路失敗 → 迴圈進入退避 sleep
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
      scheduleSyncSnapshot('c1', { students: [] })
      await vi.advanceTimersByTimeAsync(3000) // 過 debounce → 啟動迴圈 → fetch 失敗 → 進入退避 await
      expect(__getPushInFlightKeys()).toContain('c1') // 迴圈卡在退避

      await logout() // 應喚醒 sleep，迴圈頂端見 authToken=null 退出
      await vi.advanceTimersByTimeAsync(0)

      expect(__getPushInFlightKeys()).not.toContain('c1') // 單飛鎖已釋放，未永久卡死
    } finally {
      vi.useRealTimers()
    }
  })

  it('pullSnapshotPreview 不改動本機版本；commitSyncVersion 才提交（防選擇前覆蓋）', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      res(200, { success: true, data: { payload: { students: [] }, version: 8, updatedAt: null } })
    )
    const before = getLocalSyncVersion('c1')
    const snap = await pullSnapshotPreview('c1')
    expect(snap.version).toBe(8)
    expect(getLocalSyncVersion('c1')).toBe(before) // 預覽不提交版本
    await commitSyncVersion('c1', 8)
    expect(getLocalSyncVersion('c1')).toBe(8)
  })
})
