import { afterEach, expect, it, vi } from 'vitest'
import {
  createTransport, createMemoryRelayPassStore, DEFAULT_GAS_HEADERS_TIMEOUT_MS,
  DEFAULT_BODY_TIMEOUT_MS,
} from './transport.js'

const directUrl = 'https://backend.invalid'
const gasUrl = 'https://relay.invalid/exec'
const token = 'a'.repeat(64)
const relayPass = '測試通行碼'
const path = '/api/v2/ops'
const request = {
  path,
  token,
  bodyText: '{\r\n  "ops": [ { "payload": "測試🐾\\u6e2c", "op_id": "測試編號" } ], "v": 1\r\n}\n',
}
const raw = '原始回應\r\n'
const now = 100_000
const http = (status, bodyText) => ({
  status,
  text: async () => bodyText,
  arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
})
const gas = (fields = { http_status: 200, body_text: raw }) => http(200, JSON.stringify({ v: 1, ...fields }))
const fail = () => new TypeError(token + relayPass)
const pending = () => new Promise(() => {})

function setup(options = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const fetch = vi.fn()
  const relayPassStore = createMemoryRelayPassStore()
  return {
    fetch, relayPassStore,
    ...createTransport({
      fetch, backendOrigin: directUrl + '/', gasUrl, relayPassStore,
      clock: {
        now: Date.now,
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: timer => clearTimeout(timer),
      },
      ...options,
    }),
  }
}

afterEach(() => vi.useRealTimers())

it('直連等滿八秒才轉送逐字相同的本文與操作編號', async () => {
  const { fetch, send } = setup()
  fetch.mockImplementationOnce(pending).mockResolvedValueOnce(gas())
  const result = send(request)
  await vi.advanceTimersByTimeAsync(7999)
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toEqual({ kind: 'http', via: 'gas', status: 200, bodyText: raw })
  const [, direct] = fetch.mock.calls[0]
  const [, relay] = fetch.mock.calls[1]
  expect(direct.signal.aborted).toBe(true)
  expect(direct.body).toBe(request.bodyText)
  expect(JSON.parse(relay.body).body_text).toBe(direct.body)
  expect(JSON.parse(JSON.parse(relay.body).body_text).ops[0].op_id).toBe('測試編號')
})

it.each([
  [403, '禁止存取'],
  [403, '{ "error": { "code": "ORIGIN_FORBIDDEN" } }'],
  [500, '<p>伺服器錯誤</p>\r\n'],
])('直連收到 HTTP %i 與本文 %s 時只送一次', async (status, bodyText) => {
  const { fetch, send } = setup()
  fetch.mockResolvedValueOnce(http(status, bodyText)).mockResolvedValueOnce(gas())
  expect(await send(request)).toEqual({ kind: 'http', via: 'direct', status, bodyText })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('直連拒絕時不探測而直接轉送，轉送保留後端錯誤狀態及本文', async () => {
  const { fetch, send } = setup()
  fetch.mockRejectedValueOnce(new TypeError('模擬瀏覽器封鎖預檢'))
    .mockResolvedValueOnce(gas({ http_status: 503, body_text: raw }))
  expect(await send(request)).toEqual({ kind: 'http', via: 'gas', status: 503, bodyText: raw })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([directUrl + path, gasUrl])
})

it('記住成功的轉送路徑與到期時間，五分鐘到期後再走直連', async () => {
  const { fetch, send, getRememberedRoute } = setup()
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas())
    .mockResolvedValueOnce(gas()).mockResolvedValueOnce(http(200, raw))
  expect(getRememberedRoute()).toBeNull()
  await send(request)
  expect(getRememberedRoute()).toEqual({ via: 'gas', expiresAt: now + 300_000 })
  await vi.advanceTimersByTimeAsync(299_999)
  expect((await send(request)).via).toBe('gas')
  await vi.advanceTimersByTimeAsync(1)
  expect(getRememberedRoute()).toBeNull()
  expect((await send(request)).via).toBe('direct')
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([directUrl + path, gasUrl, gasUrl, directUrl + path])
})

it('直連標頭已到時，讀取本文失敗或逾時都不切路', async () => {
  const { fetch, send, getRememberedRoute } = setup()
  fetch.mockResolvedValueOnce({ status: 200, arrayBuffer: async () => { throw fail() } })
    .mockResolvedValueOnce({ status: 200, arrayBuffer: pending })
  expect(await send(request)).toEqual({ kind: 'lost', via: 'direct', reason: 'body_failed' })
  expect(getRememberedRoute()).toEqual({ via: 'direct', expiresAt: now + 300_000 })
  const result = send(request)
  await vi.advanceTimersByTimeAsync(DEFAULT_BODY_TIMEOUT_MS)
  expect(await result).toEqual({ kind: 'lost', via: 'direct', reason: 'body_timeout' })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([directUrl + path, directUrl + path])
})

it('沒有轉送網址時直連失敗只回固定的遺失代號', async () => {
  const { fetch, send } = setup({ gasUrl: undefined })
  fetch.mockRejectedValue(fail())
  expect(await send(request)).toEqual({ kind: 'lost', via: 'direct', reason: 'fetch_failed' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('轉送標頭有獨立逾時，記住轉送期間預設不反向切路', async () => {
  const { fetch, send } = setup()
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas()).mockImplementationOnce(pending)
  await send(request)
  const result = send(request)
  await vi.advanceTimersByTimeAsync(DEFAULT_GAS_HEADERS_TIMEOUT_MS - 1)
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toEqual({ kind: 'lost', via: 'gas', reason: 'headers_timeout' })
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('可設定路徑記憶條件、各階段逾時與記住轉送時反向切路', async () => {
  const { fetch, send, getRememberedRoute } = setup({
    directHeadersTimeoutMs: 5, gasHeadersTimeoutMs: 7, bodyTimeoutMs: 11,
    routeMemoryMs: 100, retryDirectOnRememberedGasFailure: true,
    isRouteSuccess: ({ via, code }) => via === 'gas' && code === 'RELAY_FORBIDDEN',
  })
  fetch.mockImplementationOnce(pending)
    .mockResolvedValueOnce(gas({ http_status: 0, gas_error: 'RELAY_FORBIDDEN' }))
    .mockImplementationOnce(pending).mockResolvedValueOnce({ status: 200, arrayBuffer: pending })
  const denied = send(request)
  await vi.advanceTimersByTimeAsync(5)
  expect((await denied).kind).toBe('gas_error')
  expect(getRememberedRoute()).toEqual({ via: 'gas', expiresAt: now + 105 })
  const fallback = send(request)
  await vi.advanceTimersByTimeAsync(7)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([directUrl + path, gasUrl, gasUrl, directUrl + path])
  await vi.advanceTimersByTimeAsync(11)
  expect(await fallback).toEqual({ kind: 'lost', via: 'direct', reason: 'body_timeout', attemptedGas: true })
})

it.each([
  ['外層本文不是 JSON', http(200, '<p>測試</p>')],
  ['缺少狀態', gas({ body_text: raw })],
  ['外層版本不符', gas({ v: 2, http_status: 200, body_text: raw })],
  ['外層狀態不是 200', http(502, '{}')],
  ['狀態型別不符', gas({ http_status: '200', body_text: raw })],
  ['狀態超出 HTTP 範圍', gas({ http_status: 700, body_text: raw })],
  ['缺少錯誤碼', gas({ http_status: 0 })],
  ['未知錯誤碼', gas({ http_status: 0, gas_error: '其他錯誤' })],
  ['原始本文型別不符', gas({ http_status: 200, body_text: {} })],
])('%s時回應算遺失', async (_label, response) => {
  const { fetch, send, getRememberedRoute } = setup()
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(response)
  expect(await send(request)).toMatchObject({ kind: 'lost', via: 'gas' })
  expect(getRememberedRoute()).toBeNull()
})

it.each([
  'BAD_ENVELOPE', 'RELAY_FORBIDDEN', 'ROUTE_NOT_ALLOWED', 'AUTH_REQUIRED', 'UPSTREAM_UNREACHABLE',
])('原樣交回轉送錯誤 %s', async code => {
  const { fetch, send, getRememberedRoute } = setup()
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas({ http_status: 0, gas_error: code }))
  expect(await send(request)).toEqual({ kind: 'gas_error', via: 'gas', code })
  expect(getRememberedRoute()).toBeNull()
})

it('輸入通行碼後下一次轉送才附上，直連請求一直沒有通行碼', async () => {
  const { fetch, send, relayPassStore } = setup()
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas({ http_status: 0, gas_error: 'RELAY_FORBIDDEN' }))
    .mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas())
  expect(relayPassStore.read()).toBeNull()
  expect(await send(request)).toEqual({ kind: 'gas_error', via: 'gas', code: 'RELAY_FORBIDDEN' })
  expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('relay_pass')
  relayPassStore.write(relayPass)
  expect(relayPassStore.read()).toBe(relayPass)
  await send(request)
  expect(JSON.parse(fetch.mock.calls[3][1].body).relay_pass).toBe(relayPass)
  for (const [url, options] of [fetch.mock.calls[0], fetch.mock.calls[2]]) {
    expect(JSON.stringify([url, options])).not.toContain(relayPass)
  }
})

it('兩條路使用乾淨網址，轉送只設內容型別並允許跟隨轉址，登入省略權杖', async () => {
  const { fetch, send } = setup()
  const verbatimToken = 'A'.repeat(64)
  fetch.mockRejectedValueOnce(fail()).mockResolvedValueOnce(gas()).mockResolvedValueOnce(gas())
  await send({ ...request, token: verbatimToken })
  await send({ ...request, path: '/api/v2/auth/login' })
  const [[direct, directOptions], [relay, relayOptions], [, loginOptions]] = fetch.mock.calls
  expect(direct).toBe(directUrl + path)
  expect(relay).toBe(gasUrl)
  expect(directOptions.method).toBe('POST')
  expect(directOptions.headers).toEqual({
    'Content-Type': 'application/json', Authorization: 'Bearer ' + verbatimToken,
  })
  expect(relayOptions.method).toBe('POST')
  expect(relayOptions.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' })
  expect(relayOptions.redirect ?? 'follow').toBe('follow')
  expect(JSON.parse(relayOptions.body)).toEqual({
    v: 1, path, token: verbatimToken, body_text: request.bodyText,
  })
  expect(JSON.parse(loginOptions.body)).not.toHaveProperty('token')
})

it('拒絕帶查詢參數的路徑及轉送網址，且不回傳原始例外', async () => {
  const { fetch, send } = setup({ gasUrl: gasUrl + '?test=' + relayPass })
  expect(await send({ ...request, path: path + '?test=' + token })).toMatchObject({ kind: 'lost' })
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRejectedValue(fail())
  expect(await send(request)).toEqual({ kind: 'lost', via: 'gas', reason: 'invalid_url' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('轉送連線與通行碼讀取失敗時，回傳內容不帶原始例外或憑證', async () => {
  const { fetch, relayPassStore, send } = setup()
  relayPassStore.write(relayPass)
  fetch.mockRejectedValue(fail())
  expect(await send(request)).toEqual({ kind: 'lost', via: 'gas', reason: 'fetch_failed' })
  vi.spyOn(relayPassStore, 'read').mockRejectedValueOnce(fail())
  expect(await send(request)).toEqual({ kind: 'lost', via: 'gas', reason: 'relay_pass_failed' })
})
