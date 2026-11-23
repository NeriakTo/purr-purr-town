import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryRelayPassStore, createTransport, DEFAULT_ROUTE_MEMORY_MS } from './transport.js'

const now = 100_000
const request = { path: '/api/v2/ops', token: 'a'.repeat(64), bodyText: '{}' }
const direct = () => new Response('{}')
const relay = () => new Response(JSON.stringify({ v: 1, http_status: 200, body_text: '{}' }))

function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const fetch = vi.fn()
  const relayPassStore = createMemoryRelayPassStore()
  return {
    fetch, relayPassStore,
    ...createTransport({
      fetch, backendOrigin: 'https://backend.invalid/', gasUrl: 'https://relay.invalid/exec',
      relayPassStore, clock: { now: Date.now, setTimeout, clearTimeout },
    }),
  }
}

afterEach(() => vi.useRealTimers())

it('記住的直連在期限後才收到回應時不續期', async () => {
  const { fetch, send, getRememberedRoute } = setup()
  let finish
  fetch.mockResolvedValueOnce(direct()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await send(request)
  const expiresAt = now + DEFAULT_ROUTE_MEMORY_MS
  expect(getRememberedRoute()).toEqual({ via: 'direct', expiresAt })
  await vi.advanceTimersByTimeAsync(DEFAULT_ROUTE_MEMORY_MS - 500)
  const response = send(request)
  await vi.advanceTimersByTimeAsync(501)
  finish(direct())
  expect(await response).toMatchObject({ kind: 'http', via: 'direct', status: 200 })
  expect(getRememberedRoute()).toBeNull()
})

it('通行碼讀取失敗時保留原本的 GAS 選路與期限', async () => {
  const { fetch, relayPassStore, send, getRememberedRoute } = setup()
  fetch.mockRejectedValueOnce(new TypeError('測試用直連失敗')).mockResolvedValueOnce(relay())
  await send(request)
  const remembered = { via: 'gas', expiresAt: now + DEFAULT_ROUTE_MEMORY_MS }
  expect(getRememberedRoute()).toEqual(remembered)
  await vi.advanceTimersByTimeAsync(1000)
  vi.spyOn(relayPassStore, 'read').mockRejectedValueOnce(new Error('測試用通行碼讀取失敗'))
  expect(await send(request)).toEqual({ kind: 'lost', via: 'gas', reason: 'relay_pass_failed' })
  expect(getRememberedRoute()).toEqual(remembered)
  expect(fetch).toHaveBeenCalledTimes(2)
})
