import { readdir, readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildV2App } from './app.js'

let app
beforeEach(() => {
  app = buildV2App({ pool: new EventEmitter(), config: { allowedOrigins: ['https://example.invalid'] } })
  app.post('/test', async request => request.body)
  app.get('/failure', async () => { throw new Error('SELECT test') })
})

afterEach(async () => {
  await app?.close()
})

test.each([
  ['JSON 解析失敗', 'application/json', '{'],
  ['本文超過 512 KiB', 'application/json', JSON.stringify('a'.repeat(512 * 1024))],
  ['未支援的內容型別', 'application/xml', '<test/>'],
  ['純文字內容型別', 'text/plain', 'test'],
])('%s回 400 BAD_ENVELOPE', async (_label, contentType, payload) => {
  const response = await app.inject({
    method: 'POST', url: '/test', headers: { 'content-type': contentType }, payload,
  })
  expect(response.statusCode).toBe(400)
  expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
})

test('未預期錯誤只回 INTERNAL_ERROR 碼', async () => {
  const response = await app.inject('/failure')
  expect(response.statusCode).toBe(500)
  expect(response.body).toBe('{"error":{"code":"INTERNAL_ERROR"}}')
})

test('CORS 只允許設定中的來源', async () => {
  for (const origin of ['https://example.invalid', 'https://unlisted.invalid']) {
    const response = await app.inject({
      method: 'OPTIONS', url: '/test',
      headers: { origin, 'access-control-request-method': 'POST' },
    })
    expect(response.headers['access-control-allow-origin'])
      .toBe(origin === 'https://example.invalid' ? origin : undefined)
  }
})

test('新版測試不載入啟動入口', async () => {
  const root = new URL('./', import.meta.url)
  const files = await readdir(root, { recursive: true })
  for (const file of files.filter(name => name.endsWith('.js') && name !== 'index.js')) {
    const source = await readFile(new URL(file, root), 'utf8')
    expect(source, file).not.toMatch(/['"][^'"]*\/(?:index(?:\.js)?)['"]/)
  }
})
