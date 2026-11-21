import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { adjustment } from '../../db-v2/test-support/operations.js'
import { hashSessionToken } from './session.js'
import { postAuth, relayHeaders, relayKey } from '../test-support/auth-http.js'
import { createLegacyTeacher, createTestClass, createTestSession } from '../test-support/fixtures.js'
import { assertNoOperationWrites, envelope, sendOps, useOpsFixtures } from '../test-support/ops.js'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('已登入端點的帳號限流', () => {
  const getFixture = useOpsFixtures()

  test('跨權杖及直連與 GAS 共用帳號限額，第四次不執行，其他老師與下一分鐘可提交', async () => {
    const fixture = getFixture()
    const { client, makeApp } = fixture
    const passcode = 'fake-rate-limit-passcode'
    const teacher = await createLegacyTeacher(client, { name: '測試限流老師', passcode })
    const target = await createTestClass(client, { owner: { kind: 'teacher', id: teacher.id } })
    let now = Date.parse('2026-11-21T08:00:10.001Z')
    const expiresAt = new Date('2027-01-01')
    const token = await createTestSession(client, teacher.id, { expiresAt })
    const secondToken = await createTestSession(client, teacher.id, { expiresAt })
    const app = makeApp({ config: { relayKey, accountRateLimit: 3 }, clock: () => new Date(now) })
    const otherApp = makeApp({ config: { relayKey, accountRateLimit: 3 }, clock: () => new Date(now) })

    function postOp(endpoint, bearer, body, headers = {}) {
      return app.inject({
        method: 'POST', url: '/api/v2/ops/' + endpoint,
        headers: { authorization: 'Bearer ' + bearer, ...headers },
        payload: body,
      })
    }

    const session = await postAuth(app, 'session', { token })
    expect(session.statusCode).toBe(200)
    const login = await postAuth(app, 'login', { body: { name: teacher.name, passcode } })
    expect(login.statusCode).toBe(200)
    expect((await postOp('lookup', secondToken, {
      class_id: target.classId, op_ids: [randomUUID()],
    }, relayHeaders)).statusCode).toBe(200)
    expect((await postOp('cancel', token, { class_id: target.classId, op_id: randomUUID() })).statusCode).toBe(200)

    const op = adjustment(target)
    const body = envelope(target.classId, [op])
    const blocked = await sendOps({ app, token: secondToken }, body, { headers: relayHeaders })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: { code: 'RATE_LIMITED', retry_after: 50 } })
    await assertNoOperationWrites(client, op.op_id)
    expect((await postAuth(app, 'logout', { token })).statusCode).toBe(429)
    expect((await postAuth(app, 'session')).statusCode).toBe(401)
    expect((await postAuth(otherApp, 'session', { token })).statusCode).toBe(200)
    expect((await postAuth(app, 'login', { body: { name: teacher.name, passcode } })).statusCode).toBe(200)

    const otherOp = adjustment(fixture.target)
    const other = await sendOps({ ...fixture, app }, envelope(fixture.target.classId, [otherOp]))
    expect(other.json().receipts[0].status).toBe('committed')

    now += 49999
    const allowed = await sendOps({ app, token: secondToken }, body)
    expect(allowed.json().receipts[0].status).toBe('committed')
    expect((await postAuth(app, 'logout', { token })).statusCode).toBe(200)
  })

  test('成功提交及登出都消耗額度，限流前仍會記首次經 GAS 時間', async () => {
    const fixture = getFixture()
    const { client, makeApp, target, teacher, token } = fixture
    const otherToken = await createTestSession(client, teacher.id, { expiresAt: new Date('2027-01-01') })
    const app = makeApp({ config: { relayKey, accountRateLimit: 1 } })
    const op = adjustment(target)
    const submitted = await sendOps({ app, token }, envelope(target.classId, [op]))
    expect(submitted.json().receipts[0].status).toBe('committed')
    expect((await postAuth(app, 'session', { token: otherToken, headers: relayHeaders })).statusCode).toBe(429)

    const { rows: [session] } = await client.query(
      'SELECT first_relayed_at FROM ppt_web_state.sessions WHERE token_hash = $1', [hashSessionToken(otherToken)],
    )
    expect(session.first_relayed_at).toEqual(new Date('2026-11-21T08:00:00.000Z'))
    const secondApp = makeApp({ config: { relayKey, accountRateLimit: 1 } })
    expect((await postAuth(secondApp, 'logout', { token: otherToken })).statusCode).toBe(200)
    expect((await postAuth(secondApp, 'session', { token })).statusCode).toBe(429)
  })
})
