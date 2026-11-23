import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { startRelayServer } from '../../../gas/relay-v2/local-server.js'
import { createMemoryRelayPassStore, createTransport } from './transport.js'

function close(server) {
  if (!server?.listening) return
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

it('直送及經本機替身送出的提交本文在後端有相同 SHA-256', async () => {
  const hashes = []
  const backend = createServer(async (request, response) => {
    const hash = createHash('sha256')
    for await (const chunk of request) hash.update(chunk)
    hashes.push(hash.digest('hex'))
    response.writeHead(200).end('\uFEFF測試回應\r\n')
  })
  let relay
  try {
    backend.listen(0, '127.0.0.1')
    await once(backend, 'listening')
    const backendOrigin = 'http://127.0.0.1:' + backend.address().port
    relay = await startRelayServer({
      backendUrl: backendOrigin, relayKey: 'fake-relay-key-'.repeat(3), upstreamTimeoutMs: 1000,
    })
    const relayPassStore = createMemoryRelayPassStore()
    const clock = {
      now: Date.now,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: timer => clearTimeout(timer),
    }
    const direct = createTransport({ fetch, backendOrigin, relayPassStore, clock, directHeadersTimeoutMs: 1000 })
    const fallback = createTransport({
      fetch: (url, options) => {
        if (url === backendOrigin + '/api/v2/ops') throw new TypeError('模擬直連失敗')
        return fetch(url, options)
      },
      backendOrigin,
      gasUrl: 'http://127.0.0.1:' + relay.address().port,
      relayPassStore,
      clock,
      gasHeadersTimeoutMs: 2000,
    })
    const request = {
      path: '/api/v2/ops',
      token: 'b'.repeat(64),
      bodyText: '{\r\n  "ops": [ { "payload": "測試🐾\\u6e2c", "op_id": "測試編號" } ], "v": 1\r\n}\n',
    }
    expect(await direct.send(request)).toEqual({ kind: 'http', via: 'direct', status: 200, bodyText: '\uFEFF測試回應\r\n' })
    expect(await fallback.send(request)).toEqual({ kind: 'http', via: 'gas', status: 200, bodyText: '\uFEFF測試回應\r\n' })
    expect(hashes).toEqual(Array(2).fill(createHash('sha256').update(request.bodyText).digest('hex')))
  } finally {
    await Promise.all([close(relay), close(backend)])
  }
}, 5000)
