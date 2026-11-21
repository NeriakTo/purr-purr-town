import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test } from 'vitest'
import { adjustment } from '../db-v2/test-support/operations.js'
import { buildV2App } from './app.js'
import { postAuth, relayHeaders, relayKey } from './test-support/auth-http.js'
import { createLegacyTeacher } from './test-support/fixtures.js'
import { assertNoOperationWrites, envelope, sendOps, useOpsFixtures } from './test-support/ops.js'

const apps = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

function sourceApp(config) {
  const app = buildV2App({ pool: new EventEmitter(), config })
  apps.push(app)
  app.get('/test', async request => ({ ip: request.ip }))
  return app
}

async function readIp(app, remoteAddress, forwarded) {
  const response = await app.inject({
    url: '/test', remoteAddress, headers: { 'x-forwarded-for': forwarded },
  })
  expect(response.statusCode).toBe(200)
  return response.json().ip
}

test('預設與 false 均忽略用戶端送出的來源位址標頭', async () => {
  for (const config of [{}, { trustProxy: false }]) {
    const app = sourceApp(config)
    expect(await readIp(app, '203.0.113.20', '198.51.100.7')).toBe('203.0.113.20')
    expect(await readIp(app, '203.0.113.20', '198.51.100.8')).toBe('203.0.113.20')
  }
})

test('只信任指定代理，從右側取第一個不受信任的位址', async () => {
  const app = sourceApp({ trustProxy: ['127.0.0.1', '192.0.2.0/24'] })
  const forwarded = '198.51.100.7, 203.0.113.9'
  expect(await readIp(app, '127.0.0.1', forwarded)).toBe('203.0.113.9')
  expect(await readIp(app, '192.0.2.1', forwarded)).toBe('203.0.113.9')
  expect(await readIp(app, '203.0.113.20', forwarded)).toBe('203.0.113.20')
})

test.each([
  ['true', true],
  ['數字', 1],
  ['函式', () => true],
  ['IPv4 全網段', ['0.0.0.0/0']],
  ['IPv6 全網段', ['::/0']],
])('拒絕 trustProxy 設為%s', (_label, trustProxy) => {
  expect(() => sourceApp({ trustProxy })).toThrow(/trustProxy/)
})

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('直連來源站台檢查', () => {
  const getFixture = useOpsFixtures()
  const allowed = 'https://example.invalid'
  const denied = 'https://unlisted.invalid'

  test('拒絕的來源在驗權杖及解析本文前回 403，登入和提交都不寫入', async () => {
    const fixture = getFixture()
    const { client, target, makeApp } = fixture
    const teacher = await createLegacyTeacher(client, { name: '測試來源老師', passcode: 'fake-origin-passcode' })
    const app = makeApp({ config: { relayKey, allowedOrigins: [allowed] } })
    const op = adjustment(target)
    const headers = { origin: denied, 'x-ppt-relay-key': 'fake-incorrect-relay-key' }
    const responses = [
      await postAuth(app, 'login', { body: { name: teacher.name, passcode: teacher.passcode }, headers }),
      await sendOps(fixture, envelope(target.classId, [op]), { app, headers }),
      await sendOps(fixture, '{', { app, headers, token: null }),
    ]
    for (const response of responses) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: { code: 'ORIGIN_FORBIDDEN' } })
    }
    await assertNoOperationWrites(client, op.op_id)
    const { rows: [counts] } = await client.query(`
      SELECT
        (SELECT count(*)::int FROM ppt_web_state.sessions WHERE teacher_id = $1) AS sessions,
        (SELECT count(*)::int FROM ppt_web_state.device_markers WHERE teacher_id = $1) AS markers
    `, [teacher.id])
    expect(counts).toEqual({ sessions: 0, markers: 0 })
  })

  test('允許的來源、未帶來源及經 GAS 帶其他來源皆可登入及提交', async () => {
    const fixture = getFixture()
    const { client, target, makeApp } = fixture
    const { name, passcode } = await createLegacyTeacher(client, {
      name: '測試許可老師', passcode: 'fake-origin-passcode',
    })
    const app = makeApp({ config: { relayKey, allowedOrigins: [allowed] } })
    for (const headers of [{ origin: allowed }, {}, { origin: denied, ...relayHeaders }]) {
      const login = await postAuth(app, 'login', { body: { name, passcode }, headers })
      expect(login.statusCode).toBe(200)
      const op = adjustment(target)
      const submission = await sendOps(fixture, envelope(target.classId, [op]), { app, headers })
      expect(submission.statusCode).toBe(200)
      expect(submission.json().receipts[0].status).toBe('committed')
    }
  })
})
