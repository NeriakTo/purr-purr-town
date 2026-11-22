import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE_PATH_ENV, DEFAULT_BASE_PATH, resolveBasePath } from '../../config/base-path.js'
import currentAppConfig from '../../vite.config.js'

describe('resolveBasePath', () => {
  it('沒設定時沿用現行網址路徑', () => {
    expect(DEFAULT_BASE_PATH).toBe('/purr-purr-town/')
    expect(resolveBasePath(undefined)).toBe('/purr-purr-town/')
    expect(resolveBasePath('')).toBe('/purr-purr-town/')
  })

  it('接受網站根目錄與多層路徑', () => {
    expect(resolveBasePath('/')).toBe('/')
    expect(resolveBasePath('/revamp/')).toBe('/revamp/')
    expect(resolveBasePath('/a/b-c_d.e~f/')).toBe('/a/b-c_d.e~f/')
  })

  it.each([
    ['revamp/'],
    ['/revamp'],
    ['//revamp/'],
    ['/../'],
    ['/a/./'],
    ['https://example.com/'],
    ['/有空白 /'],
    ['/a?b/'],
  ])('拒絕不合格的路徑 %s', value => {
    expect(() => resolveBasePath(value)).toThrow(BASE_PATH_ENV)
  })
})

describe('現行網頁的 Vite 設定', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('沒設環境變數時 base 是 /purr-purr-town/', () => {
    vi.stubEnv(BASE_PATH_ENV, undefined)
    expect(currentAppConfig({ command: 'build', mode: 'production' }).base).toBe('/purr-purr-town/')
  })

  it('環境變數設定的 base 會生效', () => {
    vi.stubEnv(BASE_PATH_ENV, '/')
    expect(currentAppConfig({ command: 'build', mode: 'production' }).base).toBe('/')
  })
})
