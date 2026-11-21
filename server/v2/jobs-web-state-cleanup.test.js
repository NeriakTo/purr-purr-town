import { readFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildV2App } from './app.js'
import { hashSessionToken } from './auth/session.js'
import { createBackgroundJobList } from './jobs/background-jobs.js'
import { cleanWebState } from './jobs/web-state-cleanup.js'
import { openWebTestDatabase } from './test-support/database.js'
import { createLegacyTeacher, createTestSession } from './test-support/fixtures.js'

const minute = 60 * 1000
const day = 24 * 60 * minute
const now = Date.parse('2026-11-14T16:05:00Z')
const clock = () => new Date(now)
const bucketKey = 'b'.repeat(64)

function captureLog() {
  const lines = []
  const stream = new Writable({
    write(chunk, encoding, done) {
      const { level: _level, time: _time, ...entry } = JSON.parse(chunk.toString())
      lines.push(entry)
      done()
    },
  })
  return { logger: Fastify({ logger: { stream, base: null } }).log, lines }
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('定期清除網站狀態', () => {
  let database
  let client
  let pool

  beforeEach(async () => {
    database = await openWebTestDatabase()
    client = database.client
    pool = database.createWebsitePool()
  }, 15000)

  afterEach(async () => database?.close(), 15000)

  function clean(options = {}) {
    return cleanWebState({ pool, config: {}, clock, logger: { info() {} }, ...options })
  }

  async function storedTokens(...tokens) {
    const { rows } = await client.query(
      'SELECT token_hash FROM ppt_web_state.sessions WHERE token_hash = ANY($1::text[])',
      [tokens.map(hashSessionToken)],
    )
    return new Set(rows.map(row => row.token_hash))
  }

  async function setupQueue() {
    await client.query(
      'INSERT INTO ppt_web_state.login_buckets (bucket_key, failures, last_failure_at) VALUES ($1, 4, $2)',
      [bucketKey, new Date(now - 31 * day)],
    )
    await client.query(`
      INSERT INTO ppt_web_state.login_queue (bucket_key, ticket, expires_at)
      VALUES ($1, 1, $2), ($1, 2, $3), ($1, 3, $4), ($1, 4, $5)
    `, [bucketKey, new Date(now - 10 * minute), new Date(now + minute),
      new Date(now - minute), new Date(now - 5 * minute)])
  }

  async function setupCounts() {
    await client.query(`
      INSERT INTO ppt_web_state.bucket_busy_counts (name, count, last_at)
      VALUES ('test-old', 1, $1), ('test-recent', 2, $2), ('test-edge', 3, $3)
    `, [new Date(now - 31 * day), new Date(now - 29 * day), new Date(now - 30 * day)])
  }

  async function queueTickets() {
    const { rows } = await client.query('SELECT ticket::int FROM ppt_web_state.login_queue ORDER BY ticket')
    return rows.map(row => row.ticket)
  }

  async function busyCounts() {
    const { rows } = await client.query('SELECT name, count::int FROM ppt_web_state.bucket_busy_counts ORDER BY name')
    return rows
  }

  async function untouchedRows() {
    const { rows: [row] } = await client.query(`
      SELECT (SELECT jsonb_agg(to_jsonb(b) ORDER BY bucket_key) FROM ppt_web_state.login_buckets b) AS buckets,
             (SELECT jsonb_agg(to_jsonb(m) ORDER BY marker_hash) FROM ppt_web_state.device_markers m) AS markers,
             (SELECT jsonb_agg(to_jsonb(e) ORDER BY class_id) FROM ppt_web_state.class_exports e) AS exports
    `)
    return row
  }

  test('工作階段依實際到期保留三十天，HTTP 區分過期與已清除', async () => {
    const { id } = await createLegacyTeacher(client, { name: '測試老師甲', passcode: '測試用密碼' })
    const active = await createTestSession(client, id, { expiresAt: new Date(now + 45 * day) })
    const recent = await createTestSession(client, id, { expiresAt: new Date(now - 29 * day) })
    const old = await createTestSession(client, id, { expiresAt: new Date(now - 31 * day) })
    const relayed = await createTestSession(client, id, {
      expiresAt: new Date(now + 45 * day), firstRelayedAt: new Date(now - 32 * day),
    })
    const edge = await createTestSession(client, id, { expiresAt: new Date(now - 30 * day) })
    await clean()
    expect(await storedTokens(active, recent, old, relayed, edge))
      .toEqual(new Set([active, recent, edge].map(hashSessionToken)))

    const app = buildV2App({ pool, clock })
    try {
      function querySession(token) {
        return app.inject({ method: 'POST', url: '/api/v2/auth/session', headers: { authorization: 'Bearer ' + token } })
      }
      const activeResponse = await querySession(active)
      expect(activeResponse.statusCode).toBe(200)
      expect(activeResponse.json().teacher.id).toBe(id)
      for (const [token, code] of [[recent, 'AUTH_EXPIRED'], [old, 'AUTH_REQUIRED']]) {
        const response = await querySession(token)
        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ error: { code } })
      }
    } finally {
      await app.close()
    }
  })

  test('排隊列保留五分鐘、忙碌計數保留三十天，三張其他表維持原列', async () => {
    const old = new Date(now - 45 * day)
    await setupQueue()
    await setupCounts()
    await client.query(`
      INSERT INTO ppt_web_state.device_markers (marker_hash, teacher_id, created_at) VALUES ($1, 'test-teacher', $2)
    `, ['a'.repeat(64), old])
    await client.query(
      "INSERT INTO ppt_web_state.class_exports (class_id, last_export_at) VALUES ('test-class', $1)", [old],
    )
    const before = await untouchedRows()
    expect(before).toEqual({ buckets: [expect.any(Object)], markers: [expect.any(Object)], exports: [expect.any(Object)] })
    await clean()
    expect(await queueTickets()).toEqual([2, 3, 4])
    expect(await busyCounts()).toEqual([{ name: 'test-edge', count: 3 }, { name: 'test-recent', count: 2 }])
    expect(await untouchedRows()).toEqual(before)
  })

  test('清除依注入的時鐘與各自保留期，三張表都使用同一個現在時間', async () => {
    const { rows: [{ database_now }] } = await client.query('SELECT clock_timestamp() AS database_now')
    const future = database_now.getTime() + 365 * day
    const oneDayAfterDatabase = new Date(database_now.getTime() + day)
    const session = await createTestSession(client, 'test-teacher', { expiresAt: oneDayAfterDatabase })
    const recent = await createTestSession(client, 'test-teacher', { expiresAt: new Date(future - 3 * day) })
    await client.query('INSERT INTO ppt_web_state.login_buckets (bucket_key) VALUES ($1)', [bucketKey])
    await client.query(
      'INSERT INTO ppt_web_state.login_queue (bucket_key, ticket, expires_at) VALUES ($1, 1, $2)',
      [bucketKey, oneDayAfterDatabase],
    )
    await client.query(`
      INSERT INTO ppt_web_state.bucket_busy_counts (name, count, last_at)
      VALUES ('test-old', 1, $1), ('test-recent', 2, $2)
    `, [oneDayAfterDatabase, new Date(future - 3 * day)])
    let clockCalls = 0
    await clean({
      config: { cleanup: { sessionRetentionMs: 2 * day, busyCountRetentionMs: 4 * day } },
      clock() {
        clockCalls++
        return new Date(future)
      },
    })
    expect(clockCalls).toBe(1)
    expect(await storedTokens(session, recent)).toEqual(new Set())
    expect(await queueTickets()).toEqual([])
    expect(await busyCounts()).toEqual([{ name: 'test-recent', count: 2 }])
  })

  test('啟動清單先跑逾期再清除，清除紀錄只有三張表的刪除筆數', async () => {
    const source = await readFile(new URL('index.js', import.meta.url), 'utf8')
    expect(source).toMatch(/startBackgroundJobs\(app,\s*\{\s*jobs:\s*createBackgroundJobList\(\)\s*\}\)/)
    const jobs = createBackgroundJobList()
    expect(jobs.map(({ name }) => name)).toEqual(['correction_overdue', 'web_state_cleanup'])

    const session = await createTestSession(client, 'test-teacher', { expiresAt: new Date(now - 31 * day) })
    await setupQueue()
    await setupCounts()
    const { logger, lines } = captureLog()
    await jobs[1].run({ pool, config: {}, clock, logger })
    expect(await storedTokens(session)).toEqual(new Set())
    expect(lines).toEqual([{ sessions: 1, login_queue: 1, bucket_busy_counts: 1 }])
  })

  test('第三張表等鎖逾時時前兩張已提交，下一輪可以補清', async () => {
    const session = await createTestSession(client, 'test-teacher', { expiresAt: new Date(now - 31 * day) })
    await setupQueue()
    await setupCounts()
    const locker = await database.connect()
    await locker.query('BEGIN')
    try {
      await locker.query('LOCK TABLE ppt_web_state.bucket_busy_counts IN ACCESS EXCLUSIVE MODE')
      await expect(clean({ config: { lockTimeoutMs: 50 } })).rejects.toMatchObject({ code: 'SERVER_BUSY' })
      expect(await storedTokens(session)).toEqual(new Set())
      expect(await queueTickets()).toEqual([2, 3, 4])
    } finally {
      await locker.query('ROLLBACK')
    }

    const { logger, lines } = captureLog()
    await clean({ logger })
    expect(lines).toEqual([{ sessions: 0, login_queue: 0, bucket_busy_counts: 1 }])
    expect(await busyCounts()).toEqual([{ name: 'test-edge', count: 3 }, { name: 'test-recent', count: 2 }])
  })
})
