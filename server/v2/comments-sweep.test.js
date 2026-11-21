import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { applyComment, commentRow, requestComment } from '../db-v2/test-support/comments.js'
import { submit } from '../db-v2/test-support/operations.js'
import { buildV2App } from './app.js'
import { sweepStuckComments } from './comments/sweep.js'
import {
  captureCommentLog, commentApplications, controlCommentTimers, generated, mockWalle, names,
  readCommentApplication, sendCommentRequest, useCommentFixtures,
} from './test-support/comment-jobs.js'
import { readOperation } from './test-support/ops.js'

const interrupted = '產生中斷，請重按產生'
const sweepDelay = 600000

async function markGenerating({ client, request, teacher }) {
  const receipt = await submit(client, request, teacher)
  expect(receipt.status).toBe('committed')
  return (await readOperation(client, request.op_id)).committed_at.getTime()
}

function runSweep(app) {
  return sweepStuckComments({ ...app.backgroundJobContext, logger: app.log })
}

async function waitForTwoSweepWriters(client) {
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    const { rowCount } = await client.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1",
      ['SELECT ppt.submit_operation(%'],
    )
    if (rowCount === 2) return
  }
  throw new Error('未觀察到兩個清掃實體同時等待班級鎖')
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('評語清掃與關閉', () => {
  const fixture = useCommentFixtures({ isolated: true })

  test('新 app 清掃逾期且沒有套用紀錄的產生中評語', async () => {
    const context = fixture()
    const committedAt = await markGenerating(context)
    const clock = () => new Date(committedAt + sweepDelay + 1000)
    const app = context.makeApp({ clock })
    await runSweep(app)
    expect(await commentRow(context.client, context.target)).toMatchObject({
      generation_status: 'failed', generation_error: interrupted,
    })
    expect(await readCommentApplication(context)).toMatchObject({
      actor_kind: 'system', status: 'committed', payload: { error: interrupted },
    })
  })

  test('尚未超過清掃門檻或剛好等於門檻時不送', async () => {
    const context = fixture()
    const committedAt = await markGenerating(context)
    let now = committedAt + sweepDelay - 1000
    const beforeServerCommit = vi.fn()
    const app = context.makeApp({ clock: () => new Date(now), hooks: { beforeServerCommit } })
    await runSweep(app)
    now = committedAt + sweepDelay
    await runSweep(app)
    expect(beforeServerCommit).not.toHaveBeenCalled()
    expect(await commentApplications(context)).toHaveLength(0)
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
  })

  test('清掃只取班級序號最大的已成立 OP-46，包含不改資料的請求', async () => {
    const context = fixture()
    const firstAt = await markGenerating(context)
    const latest = requestComment(context.target, { rev: 2 })
    expect(await submit(context.client, latest, context.teacher)).toMatchObject({ status: 'committed', result: { noop: true } })
    const latestAt = (await readOperation(context.client, latest.op_id)).committed_at.getTime()
    const rejected = requestComment(context.target, { rev: 99 })
    expect((await submit(context.client, rejected, context.teacher)).status).toBe('rejected')
    expect((await commentRow(context.client, context.target)).last_op_id).toBe(context.request.op_id)
    await context.client.query('UPDATE ppt.operations SET committed_at = $2 WHERE op_id = $1', [
      context.request.op_id, new Date(firstAt + 10000),
    ])
    const app = context.makeApp({ clock: () => new Date(latestAt + sweepDelay + 1000) })
    await runSweep(app)
    expect(await readCommentApplication(context)).toBeUndefined()
    expect(await readCommentApplication(context, latest)).toMatchObject({
      status: 'committed', payload: { request_op_id: latest.op_id, error: interrupted },
    })
    expect(await commentApplications(context)).toHaveLength(1)
  })

  test('已有定案的套用紀錄不再送，老師重按仍可恢復', async () => {
    const context = fixture()
    const committedAt = await markGenerating(context)
    const invalid = applyComment(context.target, context.request.op_id, { ...generated, comment: '評'.repeat(2001) })
    expect(await submit(context.client, invalid, { kind: 'system', id: 'system' })).toMatchObject({
      status: 'rejected', code: 'INVALID_PAYLOAD',
    })
    const beforeServerCommit = vi.fn()
    const { logger, entries } = captureCommentLog()
    const { walle } = mockWalle()
    const app = context.makeApp({
      clock: () => new Date(committedAt + sweepDelay + 1000), logger, walle, hooks: { beforeServerCommit },
    })
    await runSweep(app)
    expect(beforeServerCommit).not.toHaveBeenCalled()
    expect(entries).toEqual([expect.objectContaining({
      job: 'comment_sweep', code: 'APPLICATION_EXISTS', class_id: context.target.classId, request_op_id: context.request.op_id,
    })])
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')

    expect(await sendCommentRequest(context, app, requestComment(context.target, { rev: 2 }))).toMatchObject({
      status: 'committed', result: { noop: true },
    })
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    expect((await commentRow(context.client, context.target)).generation_status).toBe('idle')
  })

  test('清掃跳過本程序正在產生的評語，瓦力結果照常套用', async () => {
    const context = fixture()
    const hold = Promise.withResolvers()
    const { walle, entered } = mockWalle(() => hold.promise)
    let now = Date.now()
    const onGenerationTrigger = vi.fn()
    const { timers } = controlCommentTimers()
    const app = context.makeApp({ clock: () => new Date(now), walle, timers, hooks: { onGenerationTrigger } })
    try {
      await sendCommentRequest(context, app)
      expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
      await entered
      const row = await readOperation(context.client, context.request.op_id)
      now = row.committed_at.getTime() + sweepDelay + 1000
      await runSweep(app)
      expect(await commentApplications(context)).toHaveLength(0)
    } finally {
      hold.resolve(generated)
    }
    await app.whenIdle()
    expect(await commentRow(context.client, context.target)).toMatchObject({
      generation_status: 'idle', comment: names[0] + '互助，13號也是',
    })
    expect(await commentApplications(context)).toHaveLength(1)
  })

  test('兩個網站帳號連線池並行清掃，一筆成立、一筆重送', async () => {
    const context = fixture()
    const committedAt = await markGenerating(context)
    const { logger, entries } = captureCommentLog()
    const clock = () => new Date(committedAt + sweepDelay + 1000)
    const app = context.makeApp({ clock, logger })
    const secondApp = buildV2App({ pool: context.database.createWebsitePool(), clock, logger })
    const locker = await context.database.connect()
    await locker.query('BEGIN')
    const sweeps = []
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [context.target.classId])
      sweeps.push(runSweep(app), runSweep(secondApp))
      await waitForTwoSweepWriters(context.client)
    } finally {
      await locker.query('ROLLBACK')
      await Promise.all(sweeps)
      await secondApp.close()
    }
    expect(await commentApplications(context)).toHaveLength(1)
    expect(entries.map(({ code }) => code).sort()).toEqual(['OK', 'REPLAYED'])
    expect(entries.every(entry => !Object.hasOwn(entry, 'class_id') && !Object.hasOwn(entry, 'request_op_id'))).toBe(true)
  })

  test('封存班即使超過門檻也不清掃', async () => {
    const context = fixture()
    const committedAt = await markGenerating(context)
    await context.client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [context.target.classId])
    const beforeServerCommit = vi.fn()
    const app = context.makeApp({
      clock: () => new Date(committedAt + sweepDelay + 1000), hooks: { beforeServerCommit },
    })
    await runSweep(app)
    expect(beforeServerCommit).not.toHaveBeenCalled()
    expect(await commentApplications(context)).toHaveLength(0)
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
  })

  test('關閉時取消不回應的瓦力、清計時器並且不再連資料庫', async () => {
    const context = fixture()
    const { walle, entered } = mockWalle(() => new Promise(() => {}))
    const { timers, pending } = controlCommentTimers()
    const onGenerationTrigger = vi.fn()
    const beforeServerCommit = vi.fn()
    const app = context.makeApp({ walle, timers, hooks: { onGenerationTrigger, beforeServerCommit } })
    await sendCommentRequest(context, app)
    expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
    const signal = await entered
    expect(pending.size).toBe(1)
    const connect = vi.spyOn(context.pool, 'connect')
    const query = vi.spyOn(context.pool, 'query')
    try {
      await app.close()
      expect(signal.aborted).toBe(true)
      await app.whenIdle()
      expect(pending.size).toBe(0)
      expect(connect).not.toHaveBeenCalled()
      expect(query).not.toHaveBeenCalled()
      expect(beforeServerCommit).not.toHaveBeenCalled()
      expect(await readCommentApplication(context)).toBeUndefined()
      expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
    } finally {
      connect.mockRestore()
      query.mockRestore()
    }
  }, 3000)
})

test('清掃門檻必須嚴格大於逾時、全部重送等待和四倍語句逾時之和', async () => {
  const pool = new EventEmitter()
  for (const settings of [
    { timeoutMs: 120000, retryDelaysMs: [1000, 2000, 4000], statementTimeoutMs: 30000 },
    { timeoutMs: 10000, retryDelaysMs: [2, 3, 5], statementTimeoutMs: 1234 },
  ]) {
    const { statementTimeoutMs, timeoutMs, retryDelaysMs } = settings
    const limit = timeoutMs + retryDelaysMs.reduce((total, delay) => total + delay, 0) + 4 * statementTimeoutMs
    function build(sweepAfterMs) {
      return buildV2App({ pool, config: { statementTimeoutMs, comments: { timeoutMs, retryDelaysMs, sweepAfterMs } } })
    }
    expect(() => build(limit - 1)).toThrow(RangeError)
    expect(() => build(limit)).toThrow(RangeError)
    await build(limit + 1).close()
  }
})
