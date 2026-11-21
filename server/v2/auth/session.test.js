import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { requireTeacher } from './session.js'
import { createTestApp } from '../test-support/app.js'
import { openWebTestDatabase } from '../test-support/database.js'
import { createTestSession, createTestTeacher } from '../test-support/fixtures.js'

const now = new Date('2026-11-21T08:00:00Z')
const clock = () => now
const hoursAgo = hours => new Date(now.getTime() - hours * 3600000)
const teacher = createTestTeacher()

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('老師工作階段', () => {
  let database
  let pool
  let app

  beforeAll(async () => {
    database = await openWebTestDatabase()
    pool = database.createPool()
    app = createTestApp(database, { pool, clock })
    app.post('/test', async request => requireTeacher(pool, request.headers.authorization, clock))
  }, 15000)

  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await database?.close()
    }
  }, 15000)

  async function request(authorization) {
    return app.inject({ method: 'POST', url: '/test', headers: authorization ? { authorization } : {} })
  }

  test.each([
    ['沒帶', undefined],
    ['不是 Bearer', 'Basic ' + randomBytes(32).toString('hex')],
    ['長度不符', 'Bearer ' + randomBytes(31).toString('hex')],
    ['字元不符', 'Bearer ' + 'g'.repeat(64)],
    ['查不到', 'Bearer ' + randomBytes(32).toString('hex')],
  ])('%s權杖回 401 AUTH_REQUIRED', async (_label, authorization) => {
    const response = await request(authorization)
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
  })

  test.each([
    ['工作階段到期', { expiresAt: hoursAgo(1) }],
    ['到期時間等於現在', { expiresAt: now }],
    ['首次轉送已滿 24 小時', { expiresAt: hoursAgo(-80 * 24), firstRelayedAt: hoursAgo(25) }],
  ])('%s回 401 AUTH_EXPIRED', async (_label, dates) => {
    const token = await createTestSession(database.client, teacher.id, dates)
    const response = await request('Bearer ' + token)
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: 'AUTH_EXPIRED' } })
  })

  test.each([
    ['未經轉送', null],
    ['首次轉送距今 23 小時', hoursAgo(23)],
  ])('%s且在效期內可取得老師身分，資料表只存雜湊', async (_label, firstRelayedAt) => {
    const token = await createTestSession(database.client, teacher.id, {
      expiresAt: hoursAgo(-80 * 24), firstRelayedAt,
    })
    const response = await request('Bearer ' + token)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(teacher)
    const { rows } = await database.client.query(
      'SELECT to_jsonb(s)::text AS value FROM ppt_web_state.sessions s WHERE teacher_id = $1', [teacher.id],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => !row.value.includes(token))).toBe(true)
  })
})
