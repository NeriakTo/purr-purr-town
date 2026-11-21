import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { adjustment } from '../../db-v2/test-support/operations.js'
import { createTestApp } from '../test-support/app.js'
import { relayHeaders, relayKey } from '../test-support/auth-http.js'
import { openWebTestDatabase } from '../test-support/database.js'
import { createLegacyTeacher, createTestClass } from '../test-support/fixtures.js'
import { envelope, sendOps } from '../test-support/ops.js'

const pollMs = 200
const correct = 'fake-correct-password'
const wrong = 'fake-wrong-password'
const remoteAddress = '203.0.113.19'
const busyError = { code: 'RATE_LIMITED', retry_after: 30, reason: 'bucket_busy' }
const queueTable = 'ppt_web_state.login_queue'

function expectBusy(response) {
  expect(response.statusCode).toBe(429)
  expect(response.json()).toEqual({ error: busyError })
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('登入桶與排隊', () => {
  let database
  let app
  let teacher
  let now
  let delays
  let order
  let active
  let peak
  let draining
  const apps = []
  const requests = []
  const polls = []
  const pausedChecks = new Map()
  const pausedPasscodes = new Set()

  beforeAll(async () => { database = await openWebTestDatabase() }, 15000)

  beforeEach(async () => {
    const { client } = database
    await client.query('TRUNCATE ppt_web_state.login_queue, ppt_web_state.login_buckets, ppt_web_state.bucket_busy_counts')
    await client.query('TRUNCATE ppt_web_state.sessions, ppt_web_state.device_markers, public.teachers CASCADE')
    teacher = await makeTeacher()
    now = Date.parse('2026-11-21T08:00:00.000Z')
    delays = []
    order = []
    active = 0
    peak = 0
    draining = false
    app = makeApp()
  })

  afterEach(async () => {
    draining = true
    for (const passcode of pausedChecks.keys()) releaseCheck(passcode)
    pausedPasscodes.clear()
    pulse()
    await Promise.allSettled(requests.splice(0).map(request => request.response))
    await Promise.all(apps.splice(0).map(instance => instance.close()))
  }, 15000)

  afterAll(async () => { await database?.close() }, 15000)

  function makeTeacher(name = '測試登入桶甲') {
    return createLegacyTeacher(database.client, { name, passcode: correct })
  }

  function makeApp(login = {}) {
    const instance = createTestApp(database, {
      pool: database.createWebsitePool(),
      clock: () => new Date(now),
      sleep,
      verifyPassword,
      config: { relayKey, login: { dummyHashCost: 4, pollMs, ...login } },
    })
    apps.push(instance)
    return instance
  }

  function sleep(ms) {
    if (ms !== pollMs) {
      delays.push(ms)
      return Promise.resolve()
    }
    return draining ? Promise.resolve() : new Promise(resolve => polls.push(resolve))
  }

  async function verifyPassword(passcode) {
    order.push(passcode)
    active += 1
    peak = Math.max(peak, active)
    try {
      if (pausedPasscodes.has(passcode)) {
        await new Promise(resolve => {
          const checks = pausedChecks.get(passcode) ?? []
          checks.push(resolve)
          pausedChecks.set(passcode, checks)
        })
      }
      return passcode === correct
    } finally {
      active -= 1
    }
  }

  function releaseCheck(passcode) {
    pausedPasscodes.delete(passcode)
    for (const resolve of pausedChecks.get(passcode) ?? []) resolve()
    pausedChecks.delete(passcode)
  }

  function pulse() {
    for (const resolve of polls.splice(0)) resolve()
  }

  function attempt({
    instance = app, name = teacher.name, passcode = wrong, marker, headers, address = remoteAddress,
  } = {}) {
    const request = { done: false }
    request.response = instance.inject({
      method: 'POST', url: '/api/v2/auth/login', remoteAddress: address, headers,
      payload: { name, passcode, device_marker: marker },
    }).then(response => {
      request.result = response
      request.done = true
      return response
    })
    requests.push(request)
    return request
  }

  async function until(predicate, description) {
    const deadline = performance.now() + 2500
    while (!await predicate()) {
      if (performance.now() >= deadline) throw new Error(description)
      await nextTurn()
    }
  }

  async function queueCount() {
    const { rows: [row] } = await database.client.query('SELECT count(*)::int AS count FROM ' + queueTable)
    return row.count
  }

  function waitForQueue(count) {
    return until(async () => await queueCount() === count, '未觀測到指定的排隊筆數')
  }

  async function finish(batch) {
    await until(() => {
      pulse()
      return batch.every(request => request.done)
    }, '登入請求未完成')
    return batch.map(request => request.result)
  }

  async function readBuckets() {
    const { rows } = await database.client.query('SELECT * FROM ppt_web_state.login_buckets ORDER BY failures, bucket_key')
    return rows
  }

  test('前五次不延遲，之後依序延遲且成功會歸零', async () => {
    for (let index = 0; index < 5; index++) expect((await attempt().response).statusCode).toBe(401)
    expect(delays).toEqual([])
    for (let index = 0; index < 5; index++) expect((await attempt().response).statusCode).toBe(401)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000])
    expect((await attempt({ passcode: correct }).response).statusCode).toBe(200)
    expect((await attempt().response).statusCode).toBe(401)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000])
  })

  test('直連及 GAS 各錯五十次，登入過的裝置仍共用不受影響的獨立桶', async () => {
    const registration = await attempt({ passcode: correct }).response
    const marker = registration.json().device_marker
    for (const headers of [{}, relayHeaders]) {
      delays.length = 0
      for (let index = 0; index < 50; index++) {
        const failure = await attempt({ headers, address: '203.0.113.80' }).response
        expect(failure.statusCode).toBe(401)
      }
      expect(delays).toHaveLength(45)
      delays.length = 0
      const success = await attempt({ passcode: correct, marker, headers, address: '203.0.113.80' }).response
      expect(success.statusCode).toBe(200)
      expect(success.json().device_marker).toBe(marker)
      expect(delays).toEqual([])
    }
    expect((await readBuckets()).map(bucket => bucket.failures)).toEqual([0, 0, 50, 50])
  })

  test('未知名稱仍分桶，別位老師的標記與缺少標記落在同桶', async () => {
    const { device_marker: marker } = (await attempt({ passcode: correct }).response).json()
    const other = await makeTeacher('測試登入桶乙')
    for (const name of [other.name, '不存在的測試名稱']) {
      for (let index = 0; index < 5; index++) {
        expect((await attempt({ name }).response).statusCode).toBe(401)
      }
      expect((await attempt({ name, marker }).response).statusCode).toBe(401)
    }
    expect(delays).toEqual([1000, 1000])
    expect((await readBuckets()).map(bucket => bucket.failures)).toEqual([0, 6, 6])
  })

  test('同桶十個平行請求只有一個在比對、三個排隊、六個立刻回 429', async () => {
    pausedPasscodes.add(wrong)
    const batch = Array.from({ length: 10 }, () => attempt())
    await until(() => order.length > 0, '未進入密碼比對')
    await waitForQueue(3)
    await until(() => batch.filter(request => request.done).length >= 6, '超額請求未回應')
    expect(order).toHaveLength(1)
    const rejected = batch.filter(request => request.done)
    expect(rejected).toHaveLength(6)
    for (const request of rejected) expectBusy(request.result)
    expect(await queueCount()).toBe(3)
    releaseCheck(wrong)
    const responses = await finish(batch)
    expect(responses.filter(response => response.statusCode === 401)).toHaveLength(4)
    expect(peak).toBe(1)
    expect(await queueCount()).toBe(0)
    const { rows } = await database.client.query('SELECT * FROM ppt_web_state.bucket_busy_counts')
    expect(rows).toEqual([{ name: teacher.name, count: '6', last_at: new Date(now) }])
  })

  test('兩個 app 各用連線池交錯，租約共用且合計同時只比對一個', async () => {
    const other = makeApp()
    pausedPasscodes.add(wrong)
    const first = attempt()
    await until(() => order.length === 1, '第一個 app 未開始比對')
    const second = attempt({ instance: other })
    await waitForQueue(1)
    const third = attempt()
    await waitForQueue(2)
    const fourth = attempt({ instance: other })
    await waitForQueue(3)
    expect(order).toHaveLength(1)
    releaseCheck(wrong)
    const responses = await finish([first, second, third, fourth])
    expect(responses.map(response => response.statusCode)).toEqual([401, 401, 401, 401])
    expect(order).toHaveLength(4)
    expect(peak).toBe(1)
    expect((await readBuckets())[0].failures).toBe(4)
    expect(await queueCount()).toBe(0)
  })

  test('GAS 排隊先到先驗，新裝置在下一筆錯密碼前登入成功', async () => {
    pausedPasscodes.add(wrong)
    const first = attempt({ headers: relayHeaders })
    await until(() => order.length === 1, '未進入密碼比對')
    const teacherLogin = attempt({ passcode: correct, headers: relayHeaders })
    await waitForQueue(1)
    const late = 'fake-later-wrong-password'
    const next = attempt({ passcode: late, headers: relayHeaders })
    await waitForQueue(2)
    releaseCheck(wrong)
    const responses = await finish([first, teacherLogin, next])
    expect(responses.map(response => response.statusCode)).toEqual([401, 200, 401])
    expect(order).toEqual([wrong, correct, late])
  })

  test('排隊超過三十秒回 429、移除排隊列且尚未比對', async () => {
    pausedPasscodes.add(wrong)
    const first = attempt()
    await until(() => order.length === 1, '未進入密碼比對')
    const queued = attempt({ passcode: correct })
    await waitForQueue(1)
    now += 30001
    pulse()
    expectBusy(await queued.response)
    expect(await queueCount()).toBe(0)
    expect(order).toEqual([wrong])
    releaseCheck(wrong)
    await first.response
  })

  test('程序遺留的租約與隊列到期後可接手，舊號碼不能清除新租約', async () => {
    pausedPasscodes.add(wrong)
    const orphan = attempt()
    await until(() => order.length === 1, '未取得原本租約')
    const { bucket_key: key } = (await readBuckets())[0]
    await database.client.query(`
      UPDATE ppt_web_state.login_buckets SET next_ticket = 1 WHERE bucket_key = $1
    `, [key])
    await database.client.query(`
      INSERT INTO ppt_web_state.login_queue (bucket_key, ticket, expires_at) VALUES ($1, 1, $2)
    `, [key, new Date(now + 30000)])
    now += 30001
    pausedPasscodes.add(correct)
    const takeover = attempt({ instance: makeApp(), passcode: correct })
    await until(() => order.length === 2, '到期租約未被接手')
    const acquired = (await readBuckets())[0]
    expect(await queueCount()).toBe(0)
    releaseCheck(wrong)
    const expired = await orphan.response
    expect(expired.statusCode).toBe(503)
    expect(expired.json()).toEqual({ error: { code: 'SERVER_BUSY' } })
    const remaining = (await readBuckets())[0]
    expect(remaining.lease_number).toBe(acquired.lease_number)
    expect(remaining.lease_expires_at).toEqual(acquired.lease_expires_at)
    expect(remaining.failures).toBe(0)
    releaseCheck(correct)
    expect((await takeover.response).statusCode).toBe(200)
  })

  test('兩桶各一個比對與三個排隊，四連線池仍能提交 OP-24', async () => {
    const other = await makeTeacher('測試連線池老師')
    const { token } = (await attempt({ passcode: correct }).response).json()
    const target = await createTestClass(database.client, { owner: { kind: 'teacher', id: teacher.id } })
    pausedPasscodes.add(wrong)
    for (const name of [teacher.name, other.name]) {
      for (let index = 0; index < 4; index++) attempt({ name })
    }
    await waitForQueue(6)
    expect(active).toBe(2)
    const op = adjustment(target)
    const response = await sendOps({ app, token }, envelope(target.classId, [op]))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0].status).toBe('committed')
    releaseCheck(wrong)
    await finish(requests)
  })

  test('每程序只接兩個等待者，空閒的有效標記桶仍可登入', async () => {
    const limited = makeApp({ maxWaiters: 2 })
    const { device_marker: marker } = (await attempt({ instance: limited, passcode: correct }).response).json()
    const other = await makeTeacher('測試程序上限老師')
    pausedPasscodes.add(wrong)
    const held = []
    for (const name of [teacher.name, other.name]) {
      held.push(attempt({ instance: limited, name }))
    }
    await until(() => active === 2, '兩桶未進入比對')
    for (const name of [teacher.name, other.name]) {
      held.push(attempt({ instance: limited, name }))
    }
    await waitForQueue(2)
    expectBusy(await attempt({ instance: limited }).response)
    expect((await attempt({ instance: limited, passcode: correct, marker }).response).statusCode).toBe(200)
    releaseCheck(wrong)
    await finish(held)
  })

  test('偽造轉送來源位址仍累加在同桶，真正不同的對端分桶且只存雜湊', async () => {
    for (let index = 1; index <= 6; index++) {
      const headers = { 'x-forwarded-for': '198.51.100.' + index }
      expect((await attempt({ headers }).response).statusCode).toBe(401)
    }
    expect(delays).toEqual([1000])
    expect((await attempt({ address: '203.0.113.20' }).response).statusCode).toBe(401)
    expect(delays).toEqual([1000])
    const buckets = await readBuckets()
    expect(buckets.map(bucket => bucket.failures)).toEqual([1, 6])
    for (const bucket of buckets) expect(bucket.bucket_key).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(buckets)).not.toContain(teacher.name)
    expect(JSON.stringify(buckets)).not.toContain(remoteAddress)
  })
})
