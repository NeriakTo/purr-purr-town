import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { correctionRow, overdueEvent } from '../db-v2/test-support/correction-rounds.js'
import { authorizeScheduler, overdueEffects, overdueFixture } from '../db-v2/test-support/scheduler.js'
import { saveEventRule } from '../db-v2/test-support/submission-flow.js'
import { createCorrectionOverdueJob } from './jobs/correction-overdue.js'
import { correctionOverdueId } from './jobs/operation-ids.js'
import { openWebTestDatabase } from './test-support/database.js'
import { createTestClass } from './test-support/fixtures.js'

const job = 'correction_overdue'
const date = '2026-11-15'

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

function summary(counts = {}) {
  return { job, date, committed: 0, replayed: 0, rejected: 0, forbidden: 0, retry: 0, ...counts }
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('背景工作提交訂正逾期操作', () => {
  let database
  let client
  let context

  beforeEach(async () => {
    database = await openWebTestDatabase()
    client = database.client
    context = {
      pool: database.createWebsitePool(), config: {}, clock: () => new Date('2026-11-14T16:30:00Z'),
      logger: { info: vi.fn(), warn: vi.fn() },
    }
  }, 15000)

  afterEach(async () => database?.close(), 15000)

  async function addClass(suffix = '1', { authorized = true, status = 'active' } = {}) {
    const classId = '3f9c2a8e-5b71-4d2e-9a46-0c8b1e7d5f2' + suffix
    await createTestClass(client, { classId, status, students: [] })
    if (authorized) await authorizeScheduler(client, classId)
    return classId
  }

  async function overdueRecords(classId) {
    const { rows } = await client.query(`
      SELECT op_id, payload, status FROM ppt.operations
      WHERE class_id = $1 AND type = 'schedule.correction_overdue' ORDER BY class_seq
    `, [classId])
    return rows
  }

  test('UTC 仍是前一天時以臺灣日期組成 OP-52 及固定編號', async () => {
    const classId = await addClass('3')
    const beforeServerCommit = vi.fn()
    await createCorrectionOverdueJob()({ ...context, hooks: { beforeServerCommit } })
    const opId = correctionOverdueId(classId, date)
    expect(beforeServerCommit.mock.calls).toEqual([[{
      op_id: opId, class_id: classId, type: 'schedule.correction_overdue', payload: { date },
    }]])
    expect(await overdueRecords(classId)).toEqual([{ op_id: opId, payload: { date }, status: 'committed' }])
  })

  test('臺灣 00:10 前不送，00:10 整送出', async () => {
    const classId = await addClass()
    const run = createCorrectionOverdueJob()
    const beforeServerCommit = vi.fn()
    const options = { ...context, hooks: { beforeServerCommit } }
    await run({ ...options, clock: () => new Date('2026-11-14T16:05:00Z') })
    expect(beforeServerCommit).not.toHaveBeenCalled()
    expect(await overdueRecords(classId)).toEqual([])
    await run({ ...options, clock: () => new Date('2026-11-14T16:10:00Z') })
    expect(beforeServerCommit).toHaveBeenCalledOnce()
    expect(await overdueRecords(classId)).toHaveLength(1)
  })

  test('同日三輪只送一次，重啟重送也只留一筆操作與逾期扣分', async () => {
    const { classId, target } = await overdueFixture(client, {}, { due_on: '2026-11-05' })
    await saveEventRule(client, classId, overdueEvent, -6)
    const beforeServerCommit = vi.fn()
    const options = { ...context, hooks: { beforeServerCommit } }
    const run = createCorrectionOverdueJob()
    for (let i = 0; i < 3; i += 1) await run(options)
    expect(beforeServerCommit).toHaveBeenCalledOnce()
    expect(context.logger.info.mock.calls).toEqual([
      [summary({ committed: 1 })], [summary()], [summary()],
    ])
    await createCorrectionOverdueJob()(options)
    expect(beforeServerCommit).toHaveBeenCalledTimes(2)
    expect(context.logger.info).toHaveBeenLastCalledWith(summary({ replayed: 1 }))
    expect(await overdueRecords(classId)).toHaveLength(1)
    expect(await correctionRow(client, target)).toMatchObject({ overdue_on: date })
    expect(await overdueEffects(client, target)).toHaveLength(1)
  })

  test('兩個實體各用網站帳號連線池並行時一邊成立一邊重送', async () => {
    const classId = await addClass()
    await Promise.all([
      createCorrectionOverdueJob()(context),
      createCorrectionOverdueJob()({ ...context, pool: database.createWebsitePool() }),
    ])
    expect(context.logger.info.mock.calls).toHaveLength(2)
    expect(context.logger.info.mock.calls).toEqual(expect.arrayContaining([
      [summary({ committed: 1 })], [summary({ replayed: 1 })],
    ]))
    expect(await overdueRecords(classId)).toHaveLength(1)
  })

  test('依班級編號處理，未授權班當天結案且後一班成立，封存班不送', async () => {
    const last = await addClass('3')
    const middle = await addClass('2', { authorized: false })
    const first = await addClass('1')
    const archived = await addClass('4', { status: 'archived' })
    const beforeServerCommit = vi.fn()
    const run = createCorrectionOverdueJob()
    const options = { ...context, hooks: { beforeServerCommit } }
    await run(options)
    expect(context.logger.warn.mock.calls).toEqual([[{ job, date, class_id: middle, code: 'CLASS_FORBIDDEN' }]])
    expect(context.logger.info).toHaveBeenLastCalledWith(summary({ committed: 2, forbidden: 1 }))
    expect(await overdueRecords(first)).toHaveLength(1)
    expect(await overdueRecords(middle)).toEqual([])
    expect(await overdueRecords(last)).toHaveLength(1)
    expect(await overdueRecords(archived)).toEqual([])
    await authorizeScheduler(client, middle)
    await run(options)
    expect(beforeServerCommit.mock.calls.map(([op]) => op.class_id)).toEqual([first, middle, last])
    expect(await overdueRecords(middle)).toEqual([])
  })

  test('暫時失敗不擋後一班，當天只用原編號重送失敗的班級', async () => {
    const first = await addClass('1')
    const last = await addClass('2')
    const beforeServerCommit = vi.fn().mockRejectedValueOnce(new Error('測試暫時失敗'))
    const options = { ...context, hooks: { beforeServerCommit } }
    const run = createCorrectionOverdueJob()
    await run(options)
    expect(context.logger.info).toHaveBeenLastCalledWith(summary({ committed: 1, retry: 1 }))
    expect(await overdueRecords(first)).toEqual([])
    expect(await overdueRecords(last)).toHaveLength(1)
    await run(options)
    expect(beforeServerCommit.mock.calls.map(([op]) => op.class_id)).toEqual([first, last, first])
    expect(beforeServerCommit.mock.calls[2][0]).toEqual(beforeServerCommit.mock.calls[0][0])
    expect(await overdueRecords(first)).toEqual([{
      op_id: correctionOverdueId(first, date), payload: { date }, status: 'committed',
    }])
    expect(await overdueRecords(last)).toHaveLength(1)
  })

  test('班級鎖逾時留下重送資格且後一班照常成立', async () => {
    const first = await addClass('1')
    const last = await addClass('2')
    const run = createCorrectionOverdueJob()
    const options = { ...context, config: { lockTimeoutMs: 50 } }
    const locker = await database.connect()
    await locker.query('BEGIN')
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [first])
      await run(options)
      expect(context.logger.warn.mock.calls).toEqual([[{ job, date, class_id: first, code: 'SERVER_BUSY' }]])
      expect(context.logger.info).toHaveBeenLastCalledWith(summary({ committed: 1, retry: 1 }))
      expect(await overdueRecords(first)).toEqual([])
      expect(await overdueRecords(last)).toHaveLength(1)
    } finally {
      await locker.query('ROLLBACK')
    }

    await run(options)
    expect(await overdueRecords(first)).toEqual([{
      op_id: correctionOverdueId(first, date), payload: { date }, status: 'committed',
    }])
    expect(context.logger.info).toHaveBeenLastCalledWith(summary({ committed: 1 }))
  })

  test('取名單後封存造成的定案拒絕在當天結案', async () => {
    const first = await addClass('1')
    const middle = await addClass('2')
    const last = await addClass('3')
    const run = createCorrectionOverdueJob()
    const beforeServerCommit = vi.fn(async op => {
      if (op.class_id === first) {
        await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [middle])
      }
    })
    const options = { ...context, hooks: { beforeServerCommit } }
    await run(options)
    expect(context.logger.warn.mock.calls).toEqual([[{ job, date, class_id: middle, code: 'CLASS_ARCHIVED' }]])
    expect(context.logger.info).toHaveBeenLastCalledWith(summary({ committed: 2, rejected: 1 }))
    expect(await overdueRecords(last)).toHaveLength(1)
    expect(await overdueRecords(middle)).toEqual([{
      op_id: correctionOverdueId(middle, date), payload: { date }, status: 'rejected',
    }])

    await client.query("UPDATE ppt.classes SET status = 'active' WHERE class_id = $1", [middle])
    await run(options)
    expect(beforeServerCommit.mock.calls.map(([op]) => op.class_id)).toEqual([first, middle, last])
  })

  test('換日清掉結案班級，每班使用新日期的編號', async () => {
    const classIds = [await addClass('1'), await addClass('2')]
    const run = createCorrectionOverdueJob()
    await run(context)
    await run({ ...context, clock: () => new Date('2026-11-15T16:30:00Z') })
    for (const classId of classIds) {
      expect(await overdueRecords(classId)).toEqual([date, '2026-11-16'].map(day => ({
        op_id: correctionOverdueId(classId, day), payload: { date: day }, status: 'committed',
      })))
    }
  })

  test('混合結果只記彙總與失敗班級、日期和結果碼', async () => {
    await addClass('1')
    const forbidden = await addClass('2', { authorized: false })
    const retry = await addClass('3')
    const { logger, lines } = captureLog()
    const beforeServerCommit = op => {
      if (op.class_id === retry) throw new Error('測試學生甲的觀察紀錄')
    }
    await createCorrectionOverdueJob()({ ...context, logger, hooks: { beforeServerCommit } })
    expect(lines).toEqual([
      { job, date, class_id: forbidden, code: 'CLASS_FORBIDDEN' },
      { job, date, class_id: retry, code: 'INTERNAL_ERROR' },
      summary({ committed: 1, forbidden: 1, retry: 1 }),
    ])
  })
})
