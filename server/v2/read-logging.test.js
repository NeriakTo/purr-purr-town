import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { adjustment } from '../db-v2/test-support/operations.js'
import { createTestClass, createTestTeacher } from './test-support/fixtures.js'
import { commitReadOperation } from './test-support/read-entities.js'
import { readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'

const routes = [
  ['classes', () => ({})],
  ['state', class_id => ({ class_id })],
  ['changes', class_id => ({ class_id, since_seq: 1 })],
  ['export', class_id => ({ class_id })],
]

function captureLog() {
  let output = ''
  const stream = new Writable({
    write(chunk, _encoding, done) {
      output += chunk.toString()
      done()
    },
  })
  const logger = Fastify({ logger: { stream, base: null } }).log
  return { logger, read: () => output }
}

async function seedRead(context) {
  const { client, target, teacher } = context
  const student = '測試學生甲 ' + randomUUID()
  const marker = '測試紀錄記號 ' + randomUUID()
  await client.query('UPDATE ppt.students SET name = $3 WHERE class_id = $1 AND student_id = $2', [target.classId, target.studentId, student])
  await commitReadOperation(client, adjustment(target, 1), teacher)
  const operation = adjustment(target, 3)
  operation.payload.reason = marker
  await commitReadOperation(client, operation, teacher)
  return { student, marker }
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('讀取紀錄與讀取交易逾時', () => {
  const fixture = useReadFixtures()

  test.each(routes)('%s 成功、400、403 不記權杖、本文或學生資料，並沿用帳號限流', async (endpoint, bodyFor) => {
    const context = fixture()
    const { client, target, token } = context
    const { student, marker } = await seedRead(context)
    const { logger, read } = captureLog()
    const app = context.makeApp({ logger, config: { accountRateLimit: 3 } })
    const valid = { ...bodyFor(target.classId), test_marker: marker }
    const malformed = '{"test_marker":' + JSON.stringify(marker)
    const foreign = await createTestClass(client, { owner: createTestTeacher() })
    const deniedPayload = endpoint === 'classes' ? valid : { ...bodyFor(foreign.classId), test_marker: marker }
    const deniedHeaders = endpoint === 'classes' ? { origin: 'https://test.invalid' } : undefined
    const denied = await sendRead(context, endpoint, deniedPayload, { app, headers: deniedHeaders })
    expect(denied.statusCode).toBe(403)
    const bad = await sendRead(context, endpoint, malformed, { app })
    expect(bad.statusCode).toBe(400)
    const success = await sendRead(context, endpoint, valid, { app })
    expect(success.statusCode).toBe(200)
    if (endpoint === 'state' || endpoint === 'export') expect(success.body).toContain(student)
    if (endpoint !== 'classes') expect(success.body).toContain(marker)

    // 班級清單的來源拒絕發生在驗權杖之前，另外一次合法讀取補到相同的計數。
    if (endpoint === 'classes') expect((await sendRead(context, endpoint, valid, { app })).statusCode).toBe(200)
    const limited = await sendRead(context, endpoint, valid, { app })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    for (const value of [token, student, marker, JSON.stringify(valid), success.body]) expect(read()).not.toContain(value)
    expect(read()).toBe('')
  })

  test.each(routes)('%s 的讀取語句逾時回 503，紀錄只有路由、錯誤碼與 SQLSTATE', async (endpoint, bodyFor) => {
    const context = fixture()
    const { client, target, token } = context
    const { student, marker } = await seedRead(context)
    const { logger, read } = captureLog()
    const app = context.makeApp({ logger, config: { statementTimeoutMs: 60 } })
    const before = await readWriteBaseline(client)
    const valid = { ...bodyFor(target.classId), test_marker: marker }
    const table = endpoint === 'classes' ? 'ppt.class_ownership' : 'ppt.accounts'
    await client.query('BEGIN')
    let response
    try {
      await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`)
      response = await sendRead(context, endpoint, valid, { app })
    } finally {
      await client.query('ROLLBACK')
    }
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: { code: 'SERVER_BUSY' } })
    const output = read()
    for (const value of [token, student, marker, JSON.stringify(valid)]) expect(output).not.toContain(value)
    expect(output.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { level: 50, time: expect.any(Number), route: '/api/v2/read/' + endpoint, code: 'SERVER_BUSY', sqlstate: '57014' },
    ])
    expect(await readWriteBaseline(client)).toEqual(before)
  })
})
