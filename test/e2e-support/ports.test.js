import { describe, expect, it } from 'vitest'
import { assertPortsFree, probePort } from '../../scripts/e2e/ports.js'
import { readE2eSettings } from '../../scripts/e2e/settings.js'
import { createFakeDeps, runScript } from './fake-backend-deps.js'
import { listenForeign401, loopbackAvailable } from './loopback.js'

const settings = readE2eSettings({})
const free = async () => ({ inUse: false })
const busyOn = (...ports) => async port => (ports.includes(port) ? { inUse: true, reason: '連得上' } : { inUse: false })

describe('啟動前檢查三個埠', () => {
  it('三個埠都空著時通過', async () => {
    await expect(assertPortsFree(settings, { probe: free })).resolves.toBeUndefined()
  })

  it('後端埠被占用：錯誤寫明是哪個埠、怎麼用環境變數改', async () => {
    const error = await assertPortsFree(settings, { probe: busyOn(settings.apiPort) }).catch(caught => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(`127.0.0.1:${settings.apiPort}`)
    expect(error.message).toContain('PPT_E2E_API_PORT')
    expect(error.message).not.toContain('PPT_E2E_WEB_PORT')
    expect(error.message).not.toContain('PPT_E2E_DB_PORT')
  })

  it('網頁與資料庫埠同時被占用：兩個都列出', async () => {
    const error = await assertPortsFree(settings, { probe: busyOn(settings.webPort, settings.dbPort) }).catch(caught => caught)
    expect(error.message).toContain(`127.0.0.1:${settings.webPort}`)
    expect(error.message).toContain('PPT_E2E_WEB_PORT')
    expect(error.message).toContain(`127.0.0.1:${settings.dbPort}`)
    expect(error.message).toContain('PPT_E2E_DB_PORT')
    expect(error.message).not.toContain('PPT_E2E_API_PORT')
  })

  it('探測本身出錯（無法確認）也當成被占用', async () => {
    const probe = async port => {
      if (port === settings.dbPort) throw new Error('探測失敗')
      return { inUse: false }
    }
    const error = await assertPortsFree(settings, { probe }).catch(caught => caught)
    expect(error.message).toContain('PPT_E2E_DB_PORT')
    expect(error.message).toContain('探測失敗')
  })

  it('腳本在埠被占用時什麼都不啟動', async () => {
    const fake = createFakeDeps({ checkPorts: current => assertPortsFree(current, { probe: busyOn(settings.apiPort) }) })
    const run = runScript({ deps: fake.deps })
    expect(await run.exited).toBe(1)
    expect(fake.calls).toEqual([])
    expect(fake.messages.join('\n')).toContain('PPT_E2E_API_PORT')
  })
})

const loopback = await loopbackAvailable()

describe.skipIf(!loopback)('實際探測 127.0.0.1 的埠', () => {
  it('有程式在監聽判為占用；關掉之後判為空著', async () => {
    const foreign = await listenForeign401()
    try {
      expect((await probePort(foreign.port)).inUse).toBe(true)
    } finally {
      await foreign.close()
    }
    expect((await probePort(foreign.port)).inUse).toBe(false)
  })
})
