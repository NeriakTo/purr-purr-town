import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { adjustment } from '../../db-v2/test-support/operations.js'
import { hashSessionToken } from './session.js'
import { createTestApp } from '../test-support/app.js'
import { postAuth, relayHeaders, relayKey } from '../test-support/auth-http.js'
import { openWebTestDatabase } from '../test-support/database.js'
import { createLegacyTeacher, createTestClass, createTestSession } from '../test-support/fixtures.js'
import { assertNoOperationWrites, envelope, readOperation, sendOps } from '../test-support/ops.js'

const start = Date.parse('2026-11-21T08:00:00.000Z')
const minute = 60 * 1000
const hour = 60 * minute
const day = 24 * hour

function expectError(response, status, code) {
  expect(response.statusCode).toBe(status)
  expect(response.json()).toEqual({ error: { code } })
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('驗證工作階段與登出', () => {
  let database
  let app
  let teacher
  let now
  const apps = []

  beforeAll(async () => { database = await openWebTestDatabase() }, 15000)
  beforeEach(async () => {
    const { client } = database
    await client.query('TRUNCATE ppt_web_state.sessions, ppt_web_state.device_markers, public.teachers CASCADE')
    teacher = await createLegacyTeacher(client, { name: '測試老師甲', passcode: 'fake-teacher-test-passcode' })
    now = start
    app = makeApp()
  })
  afterEach(async () => { await Promise.all(apps.splice(0).map(instance => instance.close())) })
  afterAll(async () => { await database?.close() }, 15000)

  function makeApp(options = {}) {
    const instance = createTestApp(database, { config: { relayKey }, clock: () => new Date(now), ...options })
    apps.push(instance)
    return instance
  }

  async function login({ headers, instance = app } = {}) {
    const { name, passcode } = teacher
    const response = await postAuth(instance, 'login', { headers, body: { name, passcode } })
    expect(response.statusCode).toBe(200)
    return response.json()
  }

  function session(token, headers, body) {
    return postAuth(app, 'session', { token, headers, body })
  }

  function logout(token, headers) {
    return postAuth(app, 'logout', { token, headers })
  }

  async function storedSession(token) {
    const { rows: [row] } = await database.client.query(
      'SELECT * FROM ppt_web_state.sessions WHERE token_hash = $1', [hashSessionToken(token)],
    )
    return row
  }

  function makeSession(remaining, firstRelayedAt = null) {
    return createTestSession(database.client, teacher.id, { expiresAt: new Date(now + remaining), firstRelayedAt })
  }

  function makeClass(owner = { kind: 'teacher', id: teacher.id }) {
    return createTestClass(database.client, { owner })
  }

  test('經 GAS 登入在 23 小時 59 分有效，24 小時整失效', async () => {
    const { token } = await login({ headers: relayHeaders })
    now += day - minute
    expect((await session(token)).statusCode).toBe(200)
    now += minute
    expectError(await session(token), 401, 'AUTH_EXPIRED')
    expect(await storedSession(token)).toBeDefined()
  })

  test('直連登入後第一次經 GAS 起算 24 小時', async () => {
    const { token } = await login()
    now += hour
    expect((await session(token)).statusCode).toBe(200)
    expect((await storedSession(token)).first_relayed_at).toBeNull()
    now += hour
    const relayed = await session(token, relayHeaders)
    expect(relayed.statusCode).toBe(200)
    expect(relayed.json().expires_at).toBe(new Date(now + day).toISOString())
    now += day - minute
    expect((await session(token)).statusCode).toBe(200)
    now += minute
    expectError(await session(token), 401, 'AUTH_EXPIRED')
  })

  test('只走直連到第 60 天仍有效且剛好剩 30 天不延展', async () => {
    const { token, expires_at: expiry } = await login()
    now += 60 * day
    const response = await session(token)
    expect(response.statusCode).toBe(200)
    expect(response.json().expires_at).toBe(expiry)
    expect(await storedSession(token)).toMatchObject({ expires_at: new Date(expiry), first_relayed_at: null })
  })

  test('再次經 GAS 保留第一次的時間', async () => {
    const { token } = await login()
    now += hour
    expect((await session(token, relayHeaders)).statusCode).toBe(200)
    const first = new Date(now)
    now += hour
    expect((await session(token, relayHeaders)).statusCode).toBe(200)
    expect((await storedSession(token)).first_relayed_at).toEqual(first)
  })

  test('經 GAS 提交壞 JSON 在解析前記時間，無權杖先回 401', async () => {
    const { token } = await login()
    now += hour
    expectError(await sendOps({ app, token }, '{', { headers: relayHeaders }), 400, 'BAD_ENVELOPE')
    expect((await storedSession(token)).first_relayed_at).toEqual(new Date(now))
    expectError(await sendOps({ app, token: null }, '{', { headers: relayHeaders }), 401, 'AUTH_REQUIRED')
  })

  test('經 GAS 提交別人的班回 403 且仍記時間', async () => {
    const { token } = await login()
    const target = await makeClass({ kind: 'teacher', id: randomUUID() })
    const op = adjustment(target)
    now += hour
    expectError(await sendOps({ app, token }, envelope(target.classId, [op]), { headers: relayHeaders }), 403, 'CLASS_FORBIDDEN')
    await assertNoOperationWrites(database.client, op.op_id)
    expect((await storedSession(token)).first_relayed_at).toEqual(new Date(now))
  })

  test.each(['cancel', 'lookup'])('經 GAS %s 在解析壞 JSON 前記時間', async endpoint => {
    const { token } = await login()
    now += hour
    const response = await app.inject({
      method: 'POST', url: '/api/v2/ops/' + endpoint, payload: '{',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...relayHeaders },
    })
    expectError(response, 400, 'BAD_ENVELOPE')
    expect((await storedSession(token)).first_relayed_at).toEqual(new Date(now))
  })

  test.each([[31, 31], [29, 90]])('直連剩 %s 天時回傳並保存 %s 天效期', async (remaining, expected) => {
    const token = await makeSession(remaining * day)
    const response = await session(token)
    expect(response.statusCode).toBe(200)
    const expiry = new Date(now + expected * day)
    expect(response.json().expires_at).toBe(expiry.toISOString())
    expect((await storedSession(token)).expires_at).toEqual(expiry)
  })

  test('經 GAS 首次使用時即使剩 29 天也不延展', async () => {
    const token = await makeSession(29 * day)
    expect((await session(token, relayHeaders)).statusCode).toBe(200)
    expect(await storedSession(token)).toMatchObject({
      expires_at: new Date(now + 29 * day), first_relayed_at: new Date(now),
    })
  })

  test('已經過 GAS 的權杖即使剩 29 天也不延展', async () => {
    const token = await makeSession(29 * day, new Date(now - hour))
    const response = await session(token)
    expect(response.statusCode).toBe(200)
    expect(response.json().expires_at).toBe(new Date(now + 23 * hour).toISOString())
    expect((await storedSession(token)).expires_at).toEqual(new Date(now + 29 * day))
  })

  test('已過期的直連權杖不延展也不刪除', async () => {
    const token = await makeSession(-minute)
    expectError(await session(token), 401, 'AUTH_EXPIRED')
    expect((await storedSession(token)).expires_at).toEqual(new Date(now - minute))
  })

  test('查詢回傳老師名稱與較早的原始效期，忽略本文', async () => {
    const token = await makeSession(hour, new Date(now))
    const response = await session(token, undefined, { teacher: { id: 'test-other-id' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      server_time: new Date(now).toISOString(), teacher: { id: teacher.id, name: teacher.name },
      expires_at: new Date(now + hour).toISOString(),
    })
    now += hour
    expectError(await session(token), 401, 'AUTH_EXPIRED')
  })

  test('查詢缺少權杖、權杖查無或老師已刪除都回 AUTH_REQUIRED', async () => {
    expectError(await session(), 401, 'AUTH_REQUIRED')
    expectError(await session(randomBytes(32).toString('hex')), 401, 'AUTH_REQUIRED')
    const { token } = await login()
    await database.client.query('DELETE FROM public.teachers WHERE id = $1', [teacher.id])
    expect(await storedSession(token)).toBeDefined()
    expectError(await session(token), 401, 'AUTH_REQUIRED')
  })

  test('裝置標記不能當作查詢或登出權杖', async () => {
    const { device_marker: marker } = await login()
    expectError(await session(marker), 401, 'AUTH_REQUIRED')
    expectError(await logout(marker), 401, 'AUTH_REQUIRED')
  })

  test('登出刪除權杖，之後查詢、提交和再次登出都遭拒', async () => {
    const { token } = await login()
    const target = await makeClass()
    const op = adjustment(target)
    const response = await postAuth(app, 'logout', { token, body: { ignored: true } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ server_time: new Date(now).toISOString() })
    expect(await storedSession(token)).toBeUndefined()
    expectError(await session(token), 401, 'AUTH_REQUIRED')
    expectError(await sendOps({ app, token }, envelope(target.classId, [op])), 401, 'AUTH_REQUIRED')
    expectError(await logout(token), 401, 'AUTH_REQUIRED')
    await assertNoOperationWrites(database.client, op.op_id)
  })

  test('登出缺少權杖回 AUTH_REQUIRED，過期回 AUTH_EXPIRED 且保留資料', async () => {
    expectError(await logout(), 401, 'AUTH_REQUIRED')
    const token = await makeSession(0)
    expectError(await logout(token, relayHeaders), 401, 'AUTH_EXPIRED')
    expect((await storedSession(token)).first_relayed_at).toEqual(new Date(now))
    expectError(await logout(token), 401, 'AUTH_EXPIRED')
  })

  test('登出前已驗權杖的兩筆提交在登出後照常成立', async () => {
    const { token } = await login()
    const target = await makeClass()
    const [first, second] = [adjustment(target), adjustment(target)]
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const instance = makeApp({ hooks: {
      async beforeCommit(op) {
        if (op.op_id !== first.op_id) return
        entered.resolve(true)
        await resume.promise
      },
    } })
    const payload = envelope(target.classId, [first, second])
    const pending = sendOps({ app: instance, token }, payload)
    try {
      expect(await Promise.race([entered.promise, pending.then(() => false)])).toBe(true)
      expect((await logout(token)).statusCode).toBe(200)
    } finally {
      resume.resolve()
      await pending
    }
    const response = await pending
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts.map(receipt => receipt.status)).toEqual(['committed', 'committed'])
    for (const op of [first, second]) {
      expect(await readOperation(database.client, op.op_id)).toMatchObject({ actor_id: teacher.id })
    }
    expectError(await sendOps({ app: instance, token }, payload), 401, 'AUTH_REQUIRED')
  })

  test('直連提交後改走 GAS 重送，原收據只多重播標記且只有一筆交易', async () => {
    const { token } = await login()
    const target = await makeClass()
    const op = adjustment(target)
    const payload = envelope(target.classId, [op])
    const original = await sendOps({ app, token }, payload)
    expect(original.statusCode).toBe(200)
    const [receipt] = original.json().receipts
    expect(receipt.status).toBe('committed')
    now += hour
    const replay = await sendOps({ app, token }, payload, { headers: relayHeaders })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().receipts).toEqual([{ ...receipt, replayed: true }])
    expect((await storedSession(token)).first_relayed_at).toEqual(new Date(now))
    const { rowCount } = await database.client.query('SELECT 1 FROM ppt.transactions WHERE op_id = $1', [op.op_id])
    expect(rowCount).toBe(1)
  })

  test('舊版權杖不能查詢新版工作階段或提交', async () => {
    const token = randomBytes(32).toString('hex')
    await database.client.query(`
      INSERT INTO public.sessions (token_hash, teacher_id, created_at, expires_at) VALUES ($1, $2, $3, $4)
    `, [hashSessionToken(token), teacher.id, new Date(now), new Date(now + day)])
    const target = await makeClass()
    const op = adjustment(target)
    expectError(await session(token), 401, 'AUTH_REQUIRED')
    expectError(await sendOps({ app, token }, envelope(target.classId, [op])), 401, 'AUTH_REQUIRED')
    await assertNoOperationWrites(database.client, op.op_id)
  })

  test('網站角色可登入、查詢、提交 OP-24 並登出', async () => {
    const pool = database.createWebsitePool()
    const { rows } = await pool.query('SELECT current_user')
    expect(rows).toEqual([{ current_user: 'ppt_web' }])
    const instance = makeApp({ pool })
    const { token } = await login({ instance })
    expect((await postAuth(instance, 'session', { token })).statusCode).toBe(200)
    const target = await makeClass()
    const op = adjustment(target)
    const response = await sendOps({ app: instance, token }, envelope(target.classId, [op]))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0].status).toBe('committed')
    expect(await readOperation(database.client, op.op_id)).toMatchObject({ actor_id: teacher.id })
    expect((await postAuth(instance, 'logout', { token })).statusCode).toBe(200)
  })
})
