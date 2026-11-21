import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildV2App } from '../app.js'
import { postAuth, relayHeaders, relayKey } from '../test-support/auth-http.js'
import { openWebTestDatabase } from '../test-support/database.js'
import { createDeviceMarker } from './device-marker.js'
import { hashSessionToken } from './session.js'

const start = Date.parse('2026-11-21T08:00:00Z')
const limitedError = { error: { code: 'RATE_LIMITED', retry_after: 5 } }
const busyError = { error: { code: 'SERVER_BUSY' } }

function captureLog() {
  const entries = []
  const stream = new Writable({
    write(chunk, encoding, done) {
      entries.push(JSON.parse(chunk.toString()))
      done()
    },
  })
  return { entries, logger: Fastify({ logger: { stream, base: null } }).log }
}

function createLoginHarness(database, login, logger) {
  let now = start
  let peak = 0
  let draining = false
  const timers = new Set()
  const delays = []
  const active = new Map()
  const order = []
  const requests = []

  function scheduleLoginTimer(callback, ms) {
    const timer = { callback, deadline: now + ms, ms }
    timers.add(timer)
    return () => timers.delete(timer)
  }

  function advance(ms) {
    now += ms
    const due = [...timers].filter(timer => timer.deadline <= now)
    due.sort((a, b) => a.deadline - b.deadline)
    for (const timer of due) {
      if (timers.delete(timer)) timer.callback()
    }
  }

  async function verifyPassword(passcode) {
    order.push(passcode)
    if (draining) return true
    const check = Promise.withResolvers()
    active.set(passcode, check)
    peak = Math.max(peak, active.size)
    try {
      return await check.promise
    } finally {
      active.delete(passcode)
    }
  }

  function sleep(ms) {
    if (draining) return Promise.resolve()
    const delay = Promise.withResolvers()
    delays.push({ ms, ...delay })
    return delay.promise
  }

  const app = buildV2App({
    pool: database.createWebsitePool(), logger, clock: () => new Date(now),
    sleep, verifyPassword, scheduleLoginTimer, config: { relayKey, login: { dummyHashCost: 4, ...login } },
  })

  function send({ name, marker, gas = false, passcode = name }) {
    const request = { passcode }
    request.response = postAuth(app, 'login', {
      headers: gas ? relayHeaders : undefined,
      body: { name, passcode, device_marker: marker },
    }).then(response => {
      request.result = response
      return response
    })
    requests.push(request)
    return request
  }

  function observe(assertion) {
    return vi.waitFor(assertion, { timeout: 900, interval: 5 })
  }

  async function finish(request) {
    await observe(() => expect(request.result).toBeDefined())
    return request.result
  }

  function waitForCheck(request) {
    return observe(() => expect(active.has(request.passcode)).toBe(true))
  }

  function waitForTimers(ms, count) {
    return observe(() => expect([...timers].filter(timer => timer.ms === ms)).toHaveLength(count))
  }

  function waitForDelays(count) {
    return observe(() => expect(delays).toHaveLength(count))
  }

  async function waitForResponses(batch, count) {
    await observe(() => expect(batch.filter(request => request.result)).toHaveLength(count))
    return batch.filter(request => request.result)
  }

  function release(request, result = true) {
    active.get(request.passcode).resolve(result)
  }

  async function close() {
    draining = true
    for (const check of active.values()) check.resolve(true)
    for (const delay of delays) delay.resolve()
    await Promise.all(requests.map(request => request.response))
    await app.close()
  }

  return {
    send, finish, waitForCheck, waitForTimers, waitForDelays, waitForResponses, release, advance, close, active, order,
    get peak() { return peak },
    get now() { return now },
  }
}

function markerBucket(marker) {
  return hashSessionToken(JSON.stringify(['device', hashSessionToken(marker)]))
}

function anonymousBucket(name, gas) {
  return hashSessionToken(JSON.stringify(gas ? ['gas', name] : ['direct', '127.0.0.1', name]))
}

async function expectLimited(suite, request) {
  const response = await suite.finish(request)
  expect(response.statusCode).toBe(429)
  expect(response.json()).toEqual(limitedError)
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('登入比對位置', () => {
  let database
  let harness

  beforeAll(async () => { database = await openWebTestDatabase() }, 15000)

  beforeEach(async () => {
    await database.client.query(`
      TRUNCATE ppt_web_state.login_queue, ppt_web_state.login_buckets, ppt_web_state.bucket_busy_counts,
        ppt_web_state.sessions, ppt_web_state.device_markers, public.teachers CASCADE
    `)
  })

  afterEach(async () => {
    await harness?.close()
    harness = undefined
  }, 15000)

  afterAll(async () => { await database?.close() }, 15000)

  function open(login, logger) {
    harness = createLoginHarness(database, login, logger)
    return harness
  }

  async function teacher(name, createdAt = start, id = randomUUID()) {
    await database.client.query(
      'INSERT INTO public.teachers (id, name, passcode_hash, created_at) VALUES ($1, $2, $3, $4)',
      [id, name, 'fake-test-hash', createdAt === null ? null : new Date(createdAt)],
    )
    const marker = await createDeviceMarker(database.client, id, new Date(start))
    return { id, name, marker }
  }

  async function fillMarkedSlots(suite) {
    const holders = []
    for (let index = 0; index < 3; index += 1) {
      const request = suite.send(await teacher('已在比對 ' + index, start + index + 1))
      await suite.waitForCheck(request)
      holders.push(request)
    }
    return holders
  }

  async function fillAnonymousRoutes(suite, routes = [false, true]) {
    for (const gas of routes) {
      const route = gas ? '轉送' : '直連'
      await suite.waitForCheck(suite.send({ name: route + '比對', gas }))
    }
    if (routes.length === 1) {
      await suite.waitForCheck(suite.send({ name: '直連比對乙' }))
    }
    for (const gas of routes) {
      const route = gas ? '轉送' : '直連'
      for (let index = 0; index < 8; index += 1) suite.send({ name: route + '等位置 ' + index, gas })
    }
    await suite.waitForTimers(2000, routes.length * 8)
    // 以既有延遲補足各類的 16 筆同時處理數。
    const delaysPerRoute = routes.length === 2 ? 7 : 6
    for (const gas of routes) {
      const route = gas ? '轉送' : '直連'
      const names = Array.from({ length: delaysPerRoute }, (_, index) => route + '延遲 ' + index)
      await database.client.query(
        'INSERT INTO ppt_web_state.login_buckets (bucket_key, failures) SELECT unnest($1::text[]), 5',
        [names.map(name => anonymousBucket(name, gas))],
      )
      for (const name of names) suite.send({ name, gas })
    }
    await suite.waitForDelays(routes.length * delaysPerRoute)
  }

  async function bucket(key) {
    const { rows: [row] } = await database.client.query(`
      SELECT failures, lease_expires_at FROM ppt_web_state.login_buckets WHERE bucket_key = $1
    `, [key])
    return row
  }

  async function tableCounts() {
    const { rows: [counts] } = await database.client.query(`
      SELECT (SELECT count(*) FROM ppt_web_state.login_buckets) AS buckets,
             (SELECT count(*) FROM ppt_web_state.login_queue) AS queue,
             (SELECT count(*) FROM ppt_web_state.bucket_busy_counts) AS busy
    `)
    return counts
  }

  test('兩類無標記各進一筆，合計峰值二', async () => {
    const suite = open()
    await suite.waitForCheck(suite.send({ name: '直連 0' }))
    await suite.waitForCheck(suite.send({ name: '轉送 0', gas: true }))
    const direct = Array.from({ length: 9 }, (_, index) => suite.send({ name: '直連 ' + (index + 1) }))
    const gas = Array.from({ length: 9 }, (_, index) => suite.send({ name: '轉送 ' + (index + 1), gas: true }))
    await suite.waitForTimers(2000, 16)
    for (const [requests, relayed] of [[direct, false], [gas, true]]) {
      const [rejected] = await suite.waitForResponses(requests, 1)
      await expectLimited(suite, rejected)
      expect(await bucket(anonymousBucket(rejected.passcode, relayed))).toEqual({
        failures: 0, lease_expires_at: null,
      })
    }
    expect([...suite.active.keys()]).toEqual(['直連 0', '轉送 0'])
    expect(suite.peak).toBe(2)
    expect((await tableCounts()).buckets).toBe('20')
  })

  test('帶標記的比對峰值三，第四筆等位置', async () => {
    const suite = open()
    await fillMarkedSlots(suite)
    const extra = suite.send(await teacher('第四位'))
    await suite.waitForTimers(5000, 1)
    expect(suite.active.has(extra.passcode)).toBe(false)
    expect(suite.peak).toBe(3)
  })

  test('兩類無標記皆滿時，有效標記立即開始並原樣回傳', async () => {
    const suite = open()
    await fillAnonymousRoutes(suite)
    const owner = await teacher('原有老師')
    const request = suite.send(owner)
    await suite.waitForCheck(request)
    expect(suite.now).toBe(start)
    suite.release(request)
    const response = await suite.finish(request)
    expect(response.statusCode).toBe(200)
    expect(response.json().device_marker).toBe(owner.marker)
  })

  test('同時處理數達 16 後，額外 30 個名稱無資料庫寫入也無比對', async () => {
    const suite = open()
    await fillAnonymousRoutes(suite, [false])
    const counts = await tableCounts()
    const checks = suite.order.length
    const excess = Array.from({ length: 30 }, (_, index) => suite.send({ name: '額外 ' + index }))
    await Promise.all(excess.map(request => expectLimited(suite, request)))
    expect(await tableCounts()).toEqual(counts)
    expect(suite.order).toHaveLength(checks)
  })

  test.each([9900, 10100])('等位置 4900 毫秒後比對 %i 毫秒', async (duration) => {
    const suite = open()
    const holders = await fillMarkedSlots(suite)
    const owner = await teacher('租約測試老師')
    const request = suite.send(owner)
    await suite.waitForTimers(5000, 1)
    suite.advance(4900)
    suite.release(holders[0])
    await suite.waitForCheck(request)
    const key = markerBucket(owner.marker)
    expect(await bucket(key)).toEqual({ failures: 0, lease_expires_at: new Date(start + 15000) })
    suite.advance(duration)
    if (duration === 9900) {
      suite.release(request)
      expect((await suite.finish(request)).statusCode).toBe(200)
    } else {
      const response = await suite.finish(request)
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual(busyError)
      expect(suite.active.has(request.passcode)).toBe(true)
      suite.release(request, false)
      expect((await bucket(key)).failures).toBe(0)
    }
  })

  test('等位置逾時清除租約，兩種期限都不計失敗也不比對', async () => {
    const suite = open()
    await fillMarkedSlots(suite)
    const owner = await teacher('帶標記等位置')
    const marked = suite.send(owner)
    const direct = suite.send({ name: '直連等位置' })
    await suite.waitForTimers(5000, 1)
    await suite.waitForTimers(2000, 1)
    suite.advance(2000)
    await expectLimited(suite, direct)
    expect(marked.result).toBeUndefined()
    suite.advance(3000)
    await expectLimited(suite, marked)
    expect(await bucket(anonymousBucket(direct.passcode, false))).toEqual({ failures: 0, lease_expires_at: null })
    expect(await bucket(markerBucket(owner.marker))).toEqual({ failures: 0, lease_expires_at: null })
    expect(suite.order).toHaveLength(3)
  })

  test('同一老師只處理一筆，第二筆等回應，第三筆在取租約前回 429', async () => {
    const suite = open()
    const owner = await teacher('同一老師')
    const first = suite.send({ ...owner, passcode: '第一個標記' })
    await suite.waitForCheck(first)
    const secondMarker = await createDeviceMarker(database.client, owner.id, new Date(start))
    const second = suite.send({ ...owner, marker: secondMarker, passcode: '第二個標記' })
    await suite.waitForTimers(5000, 1)
    const thirdMarker = await createDeviceMarker(database.client, owner.id, new Date(start))
    const third = suite.send({ ...owner, marker: thirdMarker, passcode: '第三個標記' })
    await expectLimited(suite, third)
    expect(await bucket(markerBucket(secondMarker))).toBeUndefined()
    expect(await bucket(markerBucket(thirdMarker))).toBeUndefined()
    expect(suite.order).toEqual([first.passcode])
    suite.release(first)
    await suite.waitForCheck(second)
    expect(first.result?.statusCode).toBe(200)
    suite.release(second)
    expect((await suite.finish(second)).statusCode).toBe(200)
    expect(suite.peak).toBe(1)
  })

  test('同帳號第二筆等待逾時，原請求繼續且第二筆未取租約', async () => {
    const suite = open()
    const owner = await teacher('同帳號逾時老師')
    const first = suite.send(owner)
    await suite.waitForCheck(first)
    const marker = await createDeviceMarker(database.client, owner.id, new Date(start))
    const second = suite.send({ ...owner, marker, passcode: '等前筆逾時' })
    await suite.waitForTimers(5000, 1)
    suite.advance(5000)
    await expectLimited(suite, second)
    expect(first.result).toBeUndefined()
    expect(await bucket(markerBucket(marker))).toBeUndefined()
  })

  test('二十個較晚帳號已排隊，最早的老師先接下一個帶標記的位置', async () => {
    const suite = open()
    const owner = await teacher('最早的老師')
    await fillAnonymousRoutes(suite)
    const holder = suite.send(await teacher('正在比對的標記', start + 1))
    await suite.waitForCheck(holder)
    for (let index = 0; index < 20; index += 1) {
      suite.send(await teacher('較晚的老師 ' + index, start + index + 2))
    }
    await suite.waitForTimers(5000, 20)
    const request = suite.send(owner)
    await suite.waitForTimers(5000, 21)
    suite.release(holder)
    await suite.waitForCheck(request)
    expect(suite.order.at(-1)).toBe(owner.name)
    suite.release(request)
    expect((await suite.finish(request)).statusCode).toBe(200)
  })

  test('帶標記隊伍滿時淘汰最後一筆，排序更後的新到請求自行退出', async () => {
    const suite = open({ markedQueueLimit: 3 })
    const holders = await fillMarkedSlots(suite)
    const owner = await teacher('最早到校的老師')
    const queued = []
    for (let index = 1; index <= 3; index += 1) {
      const next = await teacher('較晚進隊 ' + index, start + index)
      queued.push({ ...next, request: suite.send(next) })
      await suite.waitForTimers(5000, index)
    }
    const request = suite.send(owner)
    await expectLimited(suite, queued[2].request)
    const latest = await teacher('更晚進隊', start + 4)
    await expectLimited(suite, suite.send(latest))
    for (const { marker } of [queued[2], latest]) {
      expect(await bucket(markerBucket(marker))).toEqual({ failures: 0, lease_expires_at: null })
    }
    suite.release(holders[0])
    await suite.waitForCheck(request)
  })

  test('相同建立時間依帳號編號排序，缺值排最後', async () => {
    const suite = open()
    const holders = await fillMarkedSlots(suite)
    const missing = suite.send(await teacher('缺少建立時間', null, 'account-0'))
    await suite.waitForTimers(5000, 1)
    const laterId = suite.send(await teacher('相同時間較後編號', start, 'account-b'))
    await suite.waitForTimers(5000, 2)
    const firstId = suite.send(await teacher('相同時間較前編號', start, 'account-a'))
    await suite.waitForTimers(5000, 3)
    suite.release(holders[0])
    await suite.waitForCheck(firstId)
    suite.release(firstId)
    await suite.waitForCheck(laterId)
    suite.release(laterId)
    await suite.waitForCheck(missing)
  })

  test('租約逾時回 503 後，原比對仍佔位置直到 Promise 結束', async () => {
    const suite = open()
    const holders = await fillMarkedSlots(suite)
    suite.advance(14900)
    for (const request of holders.slice(1)) {
      suite.release(request)
      await suite.finish(request)
    }
    for (let index = 0; index < 2; index += 1) {
      const request = suite.send(await teacher('接替 ' + index))
      await suite.waitForCheck(request)
    }
    const queued = suite.send(await teacher('逾時後仍須等'))
    await suite.waitForTimers(5000, 1)
    suite.advance(100)
    const response = await suite.finish(holders[0])
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual(busyError)
    expect(suite.active.has(queued.passcode)).toBe(false)
    expect(suite.active.size).toBe(3)
    suite.release(holders[0])
    await suite.waitForCheck(queued)
    expect(suite.peak).toBe(3)
  })

  test('直連借用兩個位置時，釋出先給尚未在比對的 GAS', async () => {
    const suite = open()
    const first = suite.send({ name: '直連先到' })
    await suite.waitForCheck(first)
    await suite.waitForCheck(suite.send({ name: '直連第二個' }))
    const direct = suite.send({ name: '直連排隊' })
    await suite.waitForTimers(2000, 1)
    const gas = suite.send({ name: '轉送排隊', gas: true })
    await suite.waitForTimers(2000, 2)
    suite.release(first)
    await suite.waitForCheck(gas)
    expect(suite.active.has(direct.passcode)).toBe(false)
  })

  test('帶標記隊伍有二十筆仍輪得到 GAS', async () => {
    const suite = open()
    const holders = await fillMarkedSlots(suite)
    for (let index = 0; index < 20; index += 1) {
      suite.send(await teacher('較晚且持續排隊的老師 ' + index, start + index + 4))
    }
    await suite.waitForTimers(5000, 20)
    const gas = suite.send({ name: '帶標記流量中的轉送', gas: true })
    await suite.waitForTimers(2000, 1)
    suite.release(holders[0])
    await suite.waitForCheck(gas)
    expect(suite.order).toHaveLength(4)
  })

  test('各類 429 每分鐘彙總一筆，下一個空白分鐘沒有紀錄', async () => {
    const { entries, logger } = captureLog()
    const suite = open({ anonymousQueuePerRoute: 0, markedQueueLimit: 0 }, logger)
    const holders = await fillMarkedSlots(suite)
    const marked = await teacher('不可記錄的老師')
    await expectLimited(suite, suite.send(marked))
    for (let index = 0; index < 2; index += 1) {
      await expectLimited(suite, suite.send({ name: '不可記錄的轉送 ' + index, gas: true }))
    }
    for (let index = 0; index < 3; index += 1) {
      await expectLimited(suite, suite.send({ name: '不可記錄的直連 ' + index }))
    }
    for (const request of holders) {
      suite.release(request)
      await suite.finish(request)
    }
    expect(entries).toEqual([])
    suite.advance(60000)
    expect(entries).toEqual([{
      level: expect.any(Number), time: expect.any(Number),
      route: '/api/v2/auth/login', code: 'RATE_LIMITED',
      marked: 1, gas: 2, direct: 3,
    }])
    suite.advance(60000)
    expect(entries).toHaveLength(1)
  })
})

test.each([
  { verifySlots: 2 },
  { verifySlots: 4, threadPoolSize: 4 },
  { delaysMs: [8000, 1000], markedSlotWaitMs: 5000, leaseMs: 10000, queueWaitMs: 23000 },
])('建立 app 時拒絕無效的登入設定 %j', (login) => {
  const pool = { on() {}, off() {} }
  expect(() => buildV2App({ pool, config: { login } })).toThrow(RangeError)
})
