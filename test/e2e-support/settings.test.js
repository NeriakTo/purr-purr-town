import { describe, expect, it } from 'vitest'
import {
  buildBackendEnv,
  DEFAULT_PORTS,
  dockerRunArgs,
  LOOPBACK,
  readE2eSettings,
} from '../../scripts/e2e/settings.js'

describe('端到端設定', () => {
  it('預設值：只綁 127.0.0.1，三個埠各自不同', () => {
    const settings = readE2eSettings({})
    expect(LOOPBACK).toBe('127.0.0.1')
    expect(settings).toMatchObject({
      host: '127.0.0.1',
      webPort: DEFAULT_PORTS.web,
      apiPort: DEFAULT_PORTS.api,
      dbPort: DEFAULT_PORTS.db,
      webOrigin: `http://127.0.0.1:${DEFAULT_PORTS.web}`,
      apiOrigin: `http://127.0.0.1:${DEFAULT_PORTS.api}`,
      postgresImage: 'postgres:16',
    })
    expect(new Set([settings.webPort, settings.apiPort, settings.dbPort]).size).toBe(3)
  })

  it('埠可由環境變數改', () => {
    const settings = readE2eSettings({ PPT_E2E_WEB_PORT: '5001', PPT_E2E_API_PORT: '5002', PPT_E2E_DB_PORT: '5003' })
    expect(settings).toMatchObject({ webPort: 5001, apiPort: 5002, dbPort: 5003 })
    expect(settings.webOrigin).toBe('http://127.0.0.1:5001')
  })

  it('主機位址不能經環境變數改掉', () => {
    const settings = readE2eSettings({ PPT_E2E_HOST: '0.0.0.0', PPT_V2_HOST: '0.0.0.0', HOST: '0.0.0.0' })
    expect(settings.host).toBe('127.0.0.1')
  })

  it.each(['0', '65536', 'abc', '3.5', '-1', ' '])('拒絕不合格的埠 %j', value => {
    expect(() => readE2eSettings({ PPT_E2E_API_PORT: value })).toThrow('PPT_E2E_API_PORT')
  })

  it('兩個用途用同一個埠時拒絕', () => {
    expect(() => readE2eSettings({ PPT_E2E_API_PORT: '6000', PPT_E2E_DB_PORT: '6000' })).toThrow('埠')
  })

  it('資料庫映像須是 PostgreSQL 16', () => {
    expect(readE2eSettings({ PPT_E2E_POSTGRES_IMAGE: 'postgres:16.4' }).postgresImage).toBe('postgres:16.4')
    expect(() => readE2eSettings({ PPT_E2E_POSTGRES_IMAGE: 'postgres:17' })).toThrow('PPT_E2E_POSTGRES_IMAGE')
  })

  it('老師名稱 1 到 50 字', () => {
    expect(readE2eSettings({}).teacherName).toBe('e2e-teacher')
    expect(() => readE2eSettings({ PPT_E2E_TEACHER_NAME: 'x'.repeat(51) })).toThrow('PPT_E2E_TEACHER_NAME')
  })
})

describe('後端啟動的環境變數', () => {
  const settings = readE2eSettings({})

  it('只綁 127.0.0.1、連本機測試庫、只允許測試網頁的來源', () => {
    const env = buildBackendEnv(settings, { webPassword: 'pw', database: 'ppt_e2e', parentEnv: { PATH: '/usr/bin' } })
    expect(env.PPT_V2_HOST).toBe('127.0.0.1')
    expect(env.PPT_V2_PORT).toBe(String(DEFAULT_PORTS.api))
    expect(env.PPT_V2_ALLOWED_ORIGINS).toBe(`http://127.0.0.1:${DEFAULT_PORTS.web}`)
    const url = new URL(env.PPT_V2_DATABASE_URL)
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.port).toBe(String(DEFAULT_PORTS.db))
    expect(url.username).toBe('ppt_web')
    expect(url.pathname).toBe('/ppt_e2e')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('不把上層環境的其他設定帶給後端', () => {
    const parentEnv = {
      PATH: '/usr/bin',
      PPT_V2_RELAY_KEY: 'x'.repeat(40),
      PPT_V2_TRUST_PROXY: '10.0.0.0/8',
      PPT_V2_DATABASE_URL: 'postgresql://someone@db.example/prod',
      PPT_TEST_DATABASE_URL: 'postgresql://someone@127.0.0.1:1/postgres',
    }
    const env = buildBackendEnv(settings, { webPassword: 'pw', database: 'ppt_e2e', parentEnv })
    expect(env).not.toHaveProperty('PPT_V2_RELAY_KEY')
    expect(env).not.toHaveProperty('PPT_V2_TRUST_PROXY')
    expect(env).not.toHaveProperty('PPT_TEST_DATABASE_URL')
    expect(env.PPT_V2_DATABASE_URL).not.toContain('db.example')
  })
})

describe('資料庫容器的啟動參數', () => {
  it('只綁 127.0.0.1、不自動下載映像、密碼經檔案傳入', () => {
    const args = dockerRunArgs(readE2eSettings({}), { containerName: 'ppt-e2e-test', envFile: '/tmp/x/env' })
    expect(args.slice(0, 2)).toEqual(['run', '--detach'])
    expect(args).toContain('--pull=never')
    expect(args).toContain('--rm')
    expect(args).toEqual(expect.arrayContaining(['--publish', `127.0.0.1:${DEFAULT_PORTS.db}:5432`]))
    expect(args).toEqual(expect.arrayContaining(['--env-file', '/tmp/x/env']))
    expect(args).toEqual(expect.arrayContaining(['--name', 'ppt-e2e-test']))
    expect(args.at(-1)).toBe('postgres:16')
    expect(args.join(' ')).not.toMatch(/POSTGRES_PASSWORD=|--network[ =]host/)
  })
})
