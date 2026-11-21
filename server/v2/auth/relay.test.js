import { EventEmitter } from 'node:events'
import { createHash, timingSafeEqual } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { buildV2App } from '../app.js'
import { postAuth, relayKey, relayHeaders } from '../test-support/auth-http.js'

vi.mock('node:crypto', async importOriginal => {
  const crypto = await importOriginal()
  return { ...crypto, timingSafeEqual: vi.fn(crypto.timingSafeEqual) }
})

test('GAS 轉送識別固定時間比對兩個 SHA-256 摘要', async () => {
  timingSafeEqual.mockClear()
  const app = buildV2App({ pool: new EventEmitter(), config: { relayKey } })
  try {
    await postAuth(app, 'login', { headers: relayHeaders, body: { name: '測試老師甲', passcode: 'fake-test' } })
    const digest = createHash('sha256').update(relayKey).digest()
    expect(timingSafeEqual).toHaveBeenCalledTimes(1)
    expect(timingSafeEqual).toHaveBeenCalledWith(digest, digest)
  } finally {
    await app.close()
  }
})

test.each([['短於 32 個字元', 'fake-short-key'], ['含非 ASCII 字元', relayKey + '喵']])(
  '%s的轉送密鑰使 app 拒絕啟動', async (_label, key) => {
    const build = () => buildV2App({ pool: new EventEmitter(), config: { relayKey: key } })
    let app
    try {
      expect(() => { app = build() }).toThrow(/relayKey/)
    } finally {
      await app?.close()
    }
  },
)
