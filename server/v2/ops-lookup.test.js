import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, test } from 'vitest'
import { ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { importedFixture, resolveLegacyEffect } from '../db-v2/test-support/legacy-effects.js'
import { addClass, adjustment, classSequence, submit } from '../db-v2/test-support/operations.js'
import { authorizeScheduler, scheduleOverdue } from '../db-v2/test-support/scheduler.js'
import { taipeiDayOffset } from '../db-v2/test-support/correction-rounds.js'
import { setStatus } from '../db-v2/test-support/submissions.js'
import { undo } from '../db-v2/test-support/undo.js'
import { cancelViaHttp, lookupViaHttp } from './test-support/operation-http.js'
import { envelope, readOperation, sendOps, serverTime, useOpsFixtures } from './test-support/ops.js'

function unknown(opId) {
  return { op_id: opId, status: 'unknown' }
}

function resultsOf(response) {
  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ server_time: serverTime, results: expect.any(Array) })
  return response.json().results
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('查詢原操作', () => {
  const fixture = useOpsFixtures()

  test('依輸入順序回原收據與種類，保留重複編號及查無結果', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const op = adjustment(target)
    const committed = await submit(client, op, teacher)
    expect(committed).toMatchObject({ status: 'committed' })
    const cancelledId = randomUUID()
    expect((await cancelViaHttp(context, cancelledId)).statusCode).toBe(200)
    const cancelled = (await readOperation(client, cancelledId)).receipt
    const missing = randomUUID()
    const opIds = [missing, cancelledId, op.op_id, cancelledId]
    expect(resultsOf(await lookupViaHttp(context, opIds))).toEqual([
      unknown(missing), { ...cancelled, op_type: null }, { ...committed, op_type: op.type },
      { ...cancelled, op_type: null },
    ])
  })

  test('用撤銷衝突的 current.last_op_id 查到 OP-53', async () => {
    const context = fixture()
    const { client, teacher } = context
    const target = await importedFixture(client, { status: 'late', suggested: true })
    await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1', [
      target.classId, teacher.id,
    ])
    const makeup = setStatus(target, 'makeup')
    const resolution = resolveLegacyEffect(target, 'link', {
      transaction_id: target.transactionId, event: 'submission.late',
    }, { rev: 2 })
    const response = await sendOps(context, envelope(target.classId, [makeup, resolution, undo(target.classId, makeup.op_id)]))
    expect(response.statusCode).toBe(200)
    const [first, second, rejected] = response.json().receipts
    expect([first.status, second.status]).toEqual(['committed', 'committed'])
    expect(rejected).toMatchObject({
      status: 'rejected', code: 'UNDO_CONFLICT',
      current: { reason: 'basis_changed', last_op_id: resolution.op_id },
    })
    const ids = [rejected.current.last_op_id]
    expect(resultsOf(await lookupViaHttp(context, ids, target.classId))).toEqual([
      { ...second, op_type: 'legacy_effect.resolve' },
    ])
  })

  test('同班小野、排程、前任老師與別班的操作都回 unknown', async () => {
    const context = fixture()
    const { client, teacher } = context
    const { classId, studentId, ops: [agentOp] } = await ruleBatch(client)
    await authorizeScheduler(client, classId)
    const scheduled = await scheduleOverdue(client, classId, await taipeiDayOffset(client, 0))
    const formerOp = adjustment({ classId, studentId })
    expect((await submit(client, formerOp)).status).toBe('committed')
    await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1', [classId, teacher.id])
    const otherOp = adjustment(context.target)
    expect((await submit(client, otherOp, teacher)).status).toBe('committed')
    const ids = [agentOp.op_id, scheduled.op_id, formerOp.op_id, otherOp.op_id]
    expect(resultsOf(await lookupViaHttp(context, ids, classId))).toEqual(ids.map(unknown))
  })

  test('持有班級列鎖時仍能查詢，尚未提交的操作回 unknown', async () => {
    const context = fixture()
    const { client, database, target, teacher } = context
    const committed = await submit(client, adjustment(target), teacher)
    expect(committed.status).toBe('committed')
    const op = adjustment(target)
    const writer = await database.connect()
    await writer.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    let pending
    const timeout = new AbortController()
    try {
      expect((await submit(writer, op, teacher)).status).toBe('committed')
      const ids = [op.op_id, committed.op_id]
      pending = lookupViaHttp(context, ids)
      const response = await Promise.race([
        pending,
        delay(2000, null, { signal: timeout.signal }).then(() => { throw new Error('查詢等待班級鎖') }),
      ])
      expect(resultsOf(response)).toEqual([unknown(op.op_id), { ...committed, op_type: op.type }])
      expect(await classSequence(client, target.classId)).toBe(committed.class_seq)
    } finally {
      timeout.abort()
      await writer.query('ROLLBACK')
      await pending
    }
  }, 8000)

  test('別人的班與不存在的班回逐位元組相同的 403', async () => {
    const context = fixture()
    const other = await addClass(context.client)
    const ids = [randomUUID()]
    const forbidden = await lookupViaHttp(context, ids, other.classId)
    const missing = await lookupViaHttp(context, ids, randomUUID())
    expect(forbidden.statusCode).toBe(403)
    expect(missing.statusCode).toBe(403)
    expect(forbidden.rawPayload).toEqual(missing.rawPayload)
    expect(missing.json()).toEqual({ error: { code: 'CLASS_FORBIDDEN' } })
  })

  test.each([
    ['空清單', []],
    ['51 個編號', Array.from({ length: 51 }, () => randomUUID())],
    ['含非字串', [1]],
    ['清單為空值', null],
  ])('%s 回 400 BAD_ENVELOPE', async (_, ids) => {
    const response = await lookupViaHttp(fixture(), ids)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
  })
})
