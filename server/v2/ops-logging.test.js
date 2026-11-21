import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { adjustment } from '../db-v2/test-support/operations.js'
import { assertNoOperationWrites, envelope, readOperation, sendOps, useOpsFixtures } from './test-support/ops.js'

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

async function holdClassLock(context) {
  const locker = await context.database.connect()
  await locker.query('BEGIN')
  await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [context.target.classId])
  return locker
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('操作紀錄只保留允許的錯誤欄位', () => {
  const fixture = useOpsFixtures()

  test.each([
    ['成功', 'OK', 'committed', undefined],
    ['定案拒絕', 'NOT_FOUND', 'rejected', undefined],
    ['等鎖逾時', 'SERVER_BUSY', 'retry', '55P03'],
    ['提交前錯誤', 'INTERNAL_ERROR', 'retry', '22023'],
  ])('%s 的紀錄沒有權杖、本文或收據', async (_, code, status, sqlstate) => {
    const context = fixture()
    const { client, target, token } = context
    const { logger, read } = captureLog()
    const marker = '測試本文-' + randomUUID()
    const op = adjustment(status === 'rejected' ? { ...target, studentId: randomUUID() } : target)
    op.payload.reason = marker
    const body = envelope(target.classId, [op])
    const config = { lockTimeoutMs: 100 }
    const hooks = code === 'INTERNAL_ERROR' ? {
      beforeCommit() {
        throw Object.assign(new Error(marker), { code: '22023' })
      },
    } : undefined
    const app = context.makeApp({ logger, config, hooks })
    const locker = code === 'SERVER_BUSY' ? await holdClassLock(context) : undefined
    let response
    try {
      response = await sendOps(context, body, { app })
    } finally {
      await locker?.query('ROLLBACK')
    }
    expect(response.statusCode).toBe(200)
    const [receipt] = response.json().receipts
    expect(receipt).toMatchObject({ op_id: op.op_id, status, code })
    if (status === 'retry') {
      await assertNoOperationWrites(client, op.op_id)
    } else {
      expect((await readOperation(client, op.op_id)).receipt).toEqual(receipt)
    }

    const output = read()
    for (const privateValue of [token, marker, op.op_id, JSON.stringify(body), JSON.stringify(receipt)]) {
      expect(output).not.toContain(privateValue)
    }
    const entries = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(entries).toEqual(sqlstate ? [
      { level: 50, time: expect.any(Number), route: '/api/v2/ops', code, sqlstate },
    ] : [])
  })
})
