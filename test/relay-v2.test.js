import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const login = '/api/v2/auth/login'
const token = 'a'.repeat(64)
const relayKey = 'b'.repeat(32)
const relayPass = '測試用通行碼'
const envelope = { v: 1, path: '/api/v2/ops', token, body_text: '{}' }
const loginEnvelope = { v: 1, path: login, body_text: '{}' }
const source = await readFile(new URL('../gas/relay-v2/Code.gs', import.meta.url), 'utf8')
const normalReply = '{ "結果": "\\u6210功" }\n'
const routes = [
  login,
  '/api/v2/auth/session',
  '/api/v2/auth/logout',
  '/api/v2/ops',
  '/api/v2/ops/lookup',
  '/api/v2/ops/cancel',
  '/api/v2/read/classes',
  '/api/v2/read/state',
  '/api/v2/read/changes',
  '/api/v2/read/export',
]
const requests = []
let backend
let relay
let protectedRelay
let shortTimeoutRelay
let backendUrl
let reply

function address(server) {
  return 'http://127.0.0.1:' + server.address().port
}

async function send(server, body, suffix = '') {
  const response = await fetch(address(server) + '/' + suffix, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toMatch(/^application\/json\b/)
  return response.json()
}

function gasError(code) {
  return { v: 1, via: 'gas', http_status: 0, gas_error: code }
}

function wrapped(status, body) {
  return { v: 1, via: 'gas', http_status: status, body_text: body }
}

function makeGasPost(fetchUpstream, overrides = {}) {
  const properties = { PPT_RELAY_BACKEND_URL: backendUrl, PPT_V2_RELAY_KEY: relayKey, ...overrides }
  const doPost = runInNewContext(source + '\n;doPost', {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => properties[key] ?? null }),
    },
    ContentService: {
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }),
      MimeType: { JSON: 'application/json' },
    },
    UrlFetchApp: { fetch: fetchUpstream },
  })
  return body => doPost({ postData: { contents: JSON.stringify(body) } })
}

async function close(server) {
  if (!server) return
  await new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  })
}

beforeAll(async () => {
  const { startRelayServer } = await import('../gas/relay-v2/local-server.js')
  backend = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
      sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
    })
    reply(response)
  })
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
  backendUrl = address(backend)
  relay = await startRelayServer({ backendUrl, relayKey, port: 0 })
  protectedRelay = await startRelayServer({ backendUrl, relayKey, relayPass, port: 0 })
  shortTimeoutRelay = await startRelayServer({ backendUrl, relayKey, port: 0, upstreamTimeoutMs: 200 })
})

beforeEach(() => {
  requests.length = 0
  reply = response => response.end(normalReply)
})

afterAll(async () => {
  await Promise.all([relay, protectedRelay, shortTimeoutRelay, backend].map(close))
})

it.each(routes)('完整比對並轉送 %s', async path => {
  const body = { ...envelope, path }
  if (path === login) delete body.token

  expect(await send(relay, body)).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ path, method: 'POST' })
  expect(requests[0].headers['content-type']).toBe('application/json')
  expect(requests[0].headers['x-ppt-relay-key']).toBe(relayKey)
  expect(requests[0].headers.authorization).toBe(path === login ? undefined : 'Bearer ' + token)
})

it('白名單外、查詢字串、路徑參數都不轉送', async () => {
  const paths = [
    '/api/v2/auth/register',
    '/api/v2/auth/pair',
    '/api/v2/health',
    '/api/v1/classes',
    '/api/v2/ops?token=' + token,
    '/api/v2/ops/測試',
    '/api/v2/ops;測試',
    '/api/v2/ops/',
    ['/api/v2/ops'],
  ]
  for (const path of paths) {
    expect(await send(relay, { ...envelope, path })).toEqual(gasError('ROUTE_NOT_ALLOWED'))
  }
  expect(await send(relay, envelope, '?token=' + token)).toEqual(gasError('ROUTE_NOT_ALLOWED'))
  expect(await send(relay, envelope, '測試')).toEqual(gasError('ROUTE_NOT_ALLOWED'))
  expect(requests).toHaveLength(0)
})

it.each([
  ['大小寫', '/API/v2/ops'],
  ['URL 編碼', '/api/v2/%6fps'],
  ['結尾斜線', '/api/v2/ops/'],
  ['原型鏈鍵 constructor', 'constructor'],
  ['原型鏈鍵 __proto__', '__proto__'],
  ['原型鏈鍵 toString', 'toString'],
  ['陣列', ['/api/v2/ops']],
  ['物件', { path: '/api/v2/ops' }],
  ['數字', 123],
])('白名單拒絕%s路徑', (_label, path) => {
  const fetchUpstream = vi.fn()
  const post = makeGasPost(fetchUpstream)
  expect(post({ ...envelope, path })).toEqual(gasError('ROUTE_NOT_ALLOWED'))
  expect(fetchUpstream).not.toHaveBeenCalled()
})

it('白名單檢查優先於權杖檢查', async () => {
  const { token: _token, ...body } = envelope
  expect(await send(relay, { ...body, path: '/不開放' })).toEqual(gasError('ROUTE_NOT_ALLOWED'))
  expect(requests).toHaveLength(0)
})

it('啟用通行碼時缺少或填錯會在查路徑前擋下', async () => {
  for (const suppliedPass of [undefined, '錯誤通行碼', relayPass + ' ']) {
    expect(await send(protectedRelay, { ...envelope, path: '/不開放', relay_pass: suppliedPass }))
      .toEqual(gasError('RELAY_FORBIDDEN'))
  }
  expect(requests).toHaveLength(0)
  expect(await send(protectedRelay, { ...envelope, relay_pass: relayPass })).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
})

it.each([
  ['null', null, 'null'],
  ['數字', 123, '123'],
  ['陣列', [relayPass], relayPass],
])('啟用通行碼時拒絕%s型別', (_label, suppliedPass, configuredPass) => {
  const fetchUpstream = vi.fn()
  const post = makeGasPost(fetchUpstream, { PPT_RELAY_PASS: configuredPass })
  expect(post({ ...envelope, relay_pass: suppliedPass })).toEqual(gasError('RELAY_FORBIDDEN'))
  expect(fetchUpstream).not.toHaveBeenCalled()
})

it('通行碼屬性為空字串時停用通行碼', async () => {
  expect(await send(relay, envelope)).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
})

it('外層 JSON、版本、本文型別或大小不合格時回 BAD_ENVELOPE', async () => {
  for (const body of ['{', 'null', { ...envelope, body_text: {} }, { ...envelope, v: 2 }]) {
    expect(await send(protectedRelay, body)).toEqual(gasError('BAD_ENVELOPE'))
  }
  const prefix = JSON.stringify({ ...envelope, body_text: '' })
  const byteBudget = 512 * 1024 - Buffer.byteLength(prefix)
  const bodyText = '測'.repeat(Math.floor(byteBudget / 3)) + 'a'.repeat(byteBudget % 3)
  expect(await send(relay, { ...envelope, body_text: bodyText + 'a' })).toEqual(gasError('BAD_ENVELOPE'))
  expect(requests).toHaveLength(0)
  expect(await send(relay, { ...envelope, body_text: bodyText })).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
})

it('登入本文的 UTF-8 上限為 4 KiB', async () => {
  const bodyText = '測'.repeat(1365) + 'a'
  expect(await send(relay, { ...loginEnvelope, body_text: bodyText + 'a' }))
    .toEqual(gasError('BAD_ENVELOPE'))
  expect(requests).toHaveLength(0)
  expect(await send(relay, { ...loginEnvelope, body_text: bodyText }))
    .toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
  expect(requests[0].headers.authorization).toBeUndefined()
})

it.each([
  ['4 KiB 登入本文', loginEnvelope, 4 * 1024],
  ['512 KiB 外層信封', envelope, 512 * 1024 - Buffer.byteLength(JSON.stringify({ ...envelope, body_text: '' }))],
])('%s按四位元組字元計算 UTF-8 上限', async (_label, body, byteBudget) => {
  const bodyText = '🐾'.repeat(Math.floor(byteBudget / 4)) + 'a'.repeat(byteBudget % 4)
  expect(await send(relay, { ...body, body_text: bodyText + 'a' })).toEqual(gasError('BAD_ENVELOPE'))
  expect(requests).toHaveLength(0)
  expect(await send(relay, { ...body, body_text: bodyText })).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(1)
})

it.each([
  ['一般權杖', token],
  ['超大權杖', 'a'.repeat(8 * 1024)],
  ['含換行的權杖', 'test\nvalue'],
  ['非 ASCII 權杖', '測試'],
  ['空字串', ''],
  ['null', null],
  ['數字', 0],
  ['布林值', false],
  ['陣列', []],
  ['物件', {}],
])('登入信封帶%s時回 BAD_ENVELOPE 且不轉送', (_label, suppliedToken) => {
  const fetchUpstream = vi.fn(() => ({ getResponseCode: () => 200, getContentText: () => normalReply }))
  const post = makeGasPost(fetchUpstream)
  expect(post({ ...loginEnvelope, token: suppliedToken })).toEqual(gasError('BAD_ENVELOPE'))
  expect(fetchUpstream).not.toHaveBeenCalled()
})

it('需權杖的路徑拒絕缺少或格式不合的權杖', async () => {
  for (const invalidToken of [undefined, 'a'.repeat(63), 'g'.repeat(64), token + '\n', [token]]) {
    expect(await send(relay, { ...envelope, token: invalidToken })).toEqual(gasError('AUTH_REQUIRED'))
  }
  expect(requests).toHaveLength(0)
})

it('需權杖的路徑拒絕大寫十六進位權杖', async () => {
  expect(await send(relay, { ...envelope, token: token.toUpperCase() })).toEqual(gasError('AUTH_REQUIRED'))
  expect(requests).toHaveLength(0)
})

it('直送與轉送同一筆操作時後端收到的 SHA-256 相同', async () => {
  const bodyText = '{\r\n  "ops": [ { "payload": "測試🐾\\u6e2c", "op_id": "測試編號" } ], "v": 1\r\n}\n'
  const direct = await fetch(backendUrl + envelope.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: bodyText,
  })
  await direct.text()
  expect(await send(relay, { ...envelope, body_text: bodyText })).toEqual(wrapped(200, normalReply))
  expect(requests).toHaveLength(2)
  expect(requests[0].sha256).toBe(requests[1].sha256)
})

it.each([
  [200, '\uFEFF 原始文字\r\n'],
  [302, '保留轉址回應\n'],
  [429, '{ "error": {"code": "RATE_LIMITED"} }\n'],
  [503, '<p>暫時無法服務</p>\r\n'],
])('原樣包裝後端 HTTP %s 與本文', async (status, body) => {
  reply = response => {
    if (status === 302) response.setHeader('Location', backendUrl + '/api/v2/auth/login')
    response.writeHead(status).end(body)
  }
  expect(await send(relay, envelope)).toEqual(wrapped(status, body))
  expect(requests).toHaveLength(1)
})

it.each([
  ['空本文', ''],
  ['開頭防劫持標記', ")]}'\n{\"結果\":true}\r\n"],
])('原樣包裝後端回應的%s', async (_label, body) => {
  reply = response => response.writeHead(200).end(body)
  expect(await send(relay, envelope)).toEqual(wrapped(200, body))
  expect(requests).toHaveLength(1)
})

it.each(['PPT_RELAY_BACKEND_URL', 'PPT_V2_RELAY_KEY'])(
  '%s 未設定或為空字串時回 UPSTREAM_UNREACHABLE 且不轉送', property => {
    const fetchUpstream = vi.fn()
    for (const value of [null, '']) {
      const post = makeGasPost(fetchUpstream, { [property]: value })
      expect(post(envelope)).toEqual(gasError('UPSTREAM_UNREACHABLE'))
      expect(fetchUpstream).not.toHaveBeenCalled()
    }
  },
)

it('後端位址的結尾斜線不會和轉送路徑重複', () => {
  const fetchUpstream = vi.fn(() => ({ getResponseCode: () => 200, getContentText: () => normalReply }))
  const post = makeGasPost(fetchUpstream, { PPT_RELAY_BACKEND_URL: backendUrl + '/' })
  expect(post(envelope)).toEqual(wrapped(200, normalReply))
  expect(fetchUpstream.mock.calls.map(([url]) => url)).toEqual([backendUrl + envelope.path])
})

it('後端連線中斷時回 UPSTREAM_UNREACHABLE 且不重試', async () => {
  reply = response => response.destroy()
  expect(await send(relay, envelope)).toEqual(gasError('UPSTREAM_UNREACHABLE'))
  expect(requests).toHaveLength(1)
})

it('後端逾時時回 UPSTREAM_UNREACHABLE 且不重試', async () => {
  reply = response => response.writeHead(200).flushHeaders()
  expect(await send(shortTimeoutRelay, envelope)).toEqual(gasError('UPSTREAM_UNREACHABLE'))
  expect(requests).toHaveLength(1)
})

it('瀏覽器從不同來源送簡單請求時可讀取回應', async () => {
  expect(relay.address().address).toBe('127.0.0.1')
  const response = await fetch(address(relay), {
    method: 'POST',
    headers: { Origin: backendUrl, 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(envelope),
  })
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect(await response.json()).toEqual(wrapped(200, normalReply))
  expect(requests[0].headers.origin).toBeUndefined()
})

it('GET 只回固定的純文字且不轉送', async () => {
  const plain = await fetch(address(relay))
  const withParams = await fetch(address(relay) + '/?token=' + token)
  expect(plain.status).toBe(200)
  expect(withParams.status).toBe(200)
  expect(plain.headers.get('content-type')).toMatch(/^text\/plain\b/)
  const message = await plain.text()
  expect(message).toMatch(/^[^\r\n]+$/)
  expect(await withParams.text()).toBe(message)
  expect(requests).toHaveLength(0)
})

it('GAS 僅讀三個指令碼屬性且沒有紀錄或屬性寫入呼叫', () => {
  expect(source).not.toMatch(/\b(?:console|Logger)\b|\b(?:SpreadsheetApp|DocumentApp|CacheService)\b/)
  expect(source).not.toMatch(/\b(?:setPropert(?:y|ies)|deleteProperty|deleteAllProperties)\b/)
  expect(source).not.toMatch(/\bget(?:Properties|Keys|UserProperties|DocumentProperties)\b/)
  expect([...source.matchAll(/\.getProperty\(['"]([^'"]+)['"]\)/g)].map(match => match[1]).sort())
    .toEqual(['PPT_RELAY_BACKEND_URL', 'PPT_RELAY_PASS', 'PPT_V2_RELAY_KEY'])
})

it('GAS 同步服務的回應與例外使用相同的包裝', () => {
  const getContentText = vi.fn(() => normalReply)
  const fetchUpstream = vi.fn()
    .mockReturnValueOnce({ getResponseCode: () => 503, getContentText })
    .mockImplementationOnce(() => { throw new Error('模擬連線失敗') })
  const post = makeGasPost(fetchUpstream)
  expect(post(envelope)).toEqual(wrapped(503, normalReply))
  expect(getContentText.mock.calls).toEqual([['UTF-8']])
  expect(post(envelope)).toEqual(gasError('UPSTREAM_UNREACHABLE'))
  expect(fetchUpstream).toHaveBeenCalledTimes(2)
  expect(fetchUpstream).toHaveBeenNthCalledWith(1, backendUrl + envelope.path, {
    method: 'post',
    contentType: 'application/json',
    payload: envelope.body_text,
    headers: { Authorization: 'Bearer ' + token, 'x-ppt-relay-key': relayKey },
    followRedirects: false,
    muteHttpExceptions: true,
  })
  expect(fetchUpstream.mock.calls[1]).toEqual(fetchUpstream.mock.calls[0])
})

it.each([
  ['同步', 'getResponseCode', false],
  ['同步', 'getContentText', false],
  ['非同步', 'getResponseCode', true],
  ['非同步', 'getContentText', true],
])('%s回應讀取 %s 失敗時回 UPSTREAM_UNREACHABLE', async (_label, accessor, asynchronous) => {
  const response = {
    getResponseCode: () => 200,
    getContentText: () => normalReply,
    [accessor]() { throw new Error('模擬回應讀取失敗') },
  }
  const fetchUpstream = vi.fn(() => asynchronous ? Promise.resolve(response) : response)
  const post = makeGasPost(fetchUpstream)
  expect(await post(envelope)).toEqual(gasError('UPSTREAM_UNREACHABLE'))
  expect(fetchUpstream).toHaveBeenCalledTimes(1)
})
