import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { comparePassword } from './password.js'
import { postAuth, relayHeaders, relayKey } from '../test-support/auth-http.js'
import { createLegacyTeacher } from '../test-support/fixtures.js'
import { useOpsFixtures } from '../test-support/ops.js'

function captureLog() {
  let output = ''
  const stream = new Writable({
    write(chunk, encoding, done) {
      output += chunk.toString()
      done()
    },
  })
  const logger = Fastify({ logger: { stream, base: null } }).log
  return { logger, read: () => output }
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('登入與工作階段紀錄', () => {
  const getFixture = useOpsFixtures()

  test('登入、拒絕、排隊、經 GAS 查詢和登出的紀錄只保留允許的錯誤欄位', async () => {
    const { client, makeApp } = getFixture()
    const { logger, read } = captureLog()
    const name = '測試紀錄老師'
    const unknownName = '測試未知帳號名稱'
    const duplicateName = '測試重複帳號名稱'
    const passcode = 'fake-private-login-passcode'
    const wrongPasscode = 'fake-private-wrong-passcode'
    const busyPasscode = 'fake-private-busy-passcode'
    const failedPasscode = 'fake-private-verifier-error'
    const remoteAddress = '203.0.113.75'
    const privateBody = 'fake-private-request-body'
    const badBody = '{"private":"fake-invalid-json-body"'
    await createLegacyTeacher(client, { name, passcode })
    for (let index = 0; index < 2; index++) {
      await createLegacyTeacher(client, { name: duplicateName, passcode })
    }
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    const app = makeApp({
      logger,
      config: { relayKey, login: { maxWaiters: 0, dummyHashCost: 4 } },
      async verifyPassword(input, hash) {
        if (input === busyPasscode) {
          entered.resolve()
          await release.promise
        }
        if (input === failedPasscode) {
          throw Object.assign(new Error(privateBody), { code: '22023' })
        }
        return comparePassword(input, hash)
      },
    })

    function login(body) {
      return app.inject({
        method: 'POST', url: '/api/v2/auth/login', remoteAddress, headers: relayHeaders,
        payload: { private: privateBody, ...body },
      })
    }

    const success = await login({ name, passcode })
    expect(success.statusCode).toBe(200)
    const { token, device_marker: marker } = success.json()
    for (const [fields, code] of [
      [{ name, passcode: wrongPasscode, device_marker: marker }, 'LOGIN_FAILED'],
      [{ name: unknownName, passcode }, 'LOGIN_FAILED'],
      [{ name: duplicateName, passcode }, 'LOGIN_FAILED'],
      [{ name, passcode: failedPasscode }, 'INTERNAL_ERROR'],
    ]) {
      const response = await login(fields)
      expect(response.json()).toEqual({ error: { code } })
    }
    const malformed = await app.inject({
      method: 'POST', url: '/api/v2/auth/login', remoteAddress,
      headers: { ...relayHeaders, 'content-type': 'application/json' }, payload: badBody,
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })

    const holding = login({ name, passcode: busyPasscode, device_marker: marker })
    try {
      await Promise.race([entered.promise, holding.then(() => { throw new Error('未進入測試比對') })])
      const busy = await login({ name, passcode, device_marker: marker })
      expect(busy.statusCode).toBe(429)
      expect(busy.json()).toEqual({ error: { code: 'RATE_LIMITED', reason: 'bucket_busy', retry_after: 30 } })
    } finally {
      release.resolve()
      expect((await holding).statusCode).toBe(401)
    }

    expect((await postAuth(app, 'session', { token, headers: relayHeaders })).statusCode).toBe(200)
    expect((await postAuth(app, 'logout', { token })).statusCode).toBe(200)

    const output = read()
    for (const secret of [
      token, marker, name, unknownName, duplicateName, passcode, wrongPasscode, busyPasscode,
      failedPasscode, remoteAddress, relayKey, privateBody, 'fake-invalid-json-body',
    ]) {
      expect(output).not.toContain(secret)
    }
    const entries = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(entries).toEqual([
      { level: 50, time: expect.any(Number), route: '/api/v2/auth/login', code: 'DUPLICATE_LOGIN_NAME' },
      { level: 50, time: expect.any(Number), route: '/api/v2/auth/login', code: 'INTERNAL_ERROR', sqlstate: '22023' },
    ])
  })
})
