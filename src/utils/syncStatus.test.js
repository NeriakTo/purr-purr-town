import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSyncStatus,
  setSyncStatus,
  markConflict,
  clearConflict,
  subscribeSyncStatus,
  __resetSyncStatus,
} from './syncStatus'

describe('syncStatus 同步狀態存', () => {
  beforeEach(() => __resetSyncStatus())

  it('預設為 disconnected、無衝突', () => {
    expect(getSyncStatus()).toEqual({ status: 'disconnected', conflicts: [] })
  })

  it('setSyncStatus 只接受合法狀態', () => {
    setSyncStatus('connected')
    expect(getSyncStatus().status).toBe('connected')
    setSyncStatus('不存在的狀態')
    expect(getSyncStatus().status).toBe('connected')
  })

  it('訂閱者立即收到目前狀態，且狀態變更時被通知', () => {
    const seen = []
    const unsub = subscribeSyncStatus(s => seen.push(s.status))
    setSyncStatus('connected')
    setSyncStatus('expired')
    unsub()
    setSyncStatus('offline') // 已退訂，不應再收到
    expect(seen).toEqual(['disconnected', 'connected', 'expired'])
  })

  it('markConflict / clearConflict 管理每班衝突旗標', () => {
    setSyncStatus('connected')
    markConflict('c1')
    markConflict('c1') // 去重
    markConflict('c2')
    expect(getSyncStatus().conflicts.sort()).toEqual(['c1', 'c2'])
    clearConflict('c1')
    expect(getSyncStatus().conflicts).toEqual(['c2'])
  })

  it('切到 expired 或 disconnected 時清掉衝突旗標', () => {
    setSyncStatus('connected')
    markConflict('c1')
    setSyncStatus('expired')
    expect(getSyncStatus().conflicts).toEqual([])
  })

  it('相同狀態不重複通知', () => {
    setSyncStatus('connected')
    let count = 0
    subscribeSyncStatus(() => count++) // 立即一次 = 1
    setSyncStatus('connected') // 無變化，不通知
    expect(count).toBe(1)
  })
})
