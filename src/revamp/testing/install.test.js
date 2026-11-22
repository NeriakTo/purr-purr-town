import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { TEST_HOOK_GLOBAL } from './constants.js'
import { buildTestApi, installTestHooks } from './install.js'

describe('只供測試的操作入口', () => {
  it('掛上全域物件，經 idbProbe 寫一筆再讀回', async () => {
    const target = { indexedDB: new IDBFactory() }
    installTestHooks(target)

    const api = target[TEST_HOOK_GLOBAL]
    expect(api).toBeDefined()
    expect(await api.idbProbe.get('demo-1')).toBeUndefined()
    await api.idbProbe.put({ id: 'demo-1', label: '假資料一號' })
    expect(await api.idbProbe.get('demo-1')).toEqual({ id: 'demo-1', label: '假資料一號' })
  })

  it('全域物件不能被覆寫，重複安裝會報錯', () => {
    const target = { indexedDB: new IDBFactory() }
    installTestHooks(target)
    const api = target[TEST_HOOK_GLOBAL]

    expect(() => installTestHooks(target)).toThrow(`${TEST_HOOK_GLOBAL} 已經安裝過`)
    expect(() => { target[TEST_HOOK_GLOBAL] = {} }).toThrow(TypeError)
    expect(target[TEST_HOOK_GLOBAL]).toBe(api)
    expect(Object.isFrozen(api)).toBe(true)
  })

  it('掛勾模組缺欄位或名稱重複時拒絕', () => {
    const deps = { indexedDB: new IDBFactory() }
    const ok = { name: 'ok', create: () => ({}) }
    expect(() => buildTestApi({ './a.js': { create: () => ({}) } }, deps)).toThrow('./a.js')
    expect(() => buildTestApi({ './b.js': { name: 'b' } }, deps)).toThrow('./b.js')
    expect(() => buildTestApi({ './c.js': ok, './d.js': ok }, deps)).toThrow('ok')
    expect(buildTestApi({ './c.js': ok }, deps)).toHaveProperty('ok')
  })
})
