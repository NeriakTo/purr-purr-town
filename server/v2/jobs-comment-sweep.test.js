import { describe, expect, test } from 'vitest'
import { commentRow } from '../db-v2/test-support/comments.js'
import { createBackgroundJobList, startBackgroundJobs } from './jobs/background-jobs.js'
import { controlCommentTimers, mockWalle, sendCommentRequest, useCommentFixtures } from './test-support/comment-jobs.js'
import { readOperation } from './test-support/ops.js'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('背景工作評語清掃', () => {
  const fixture = useCommentFixtures()

  test('啟動清掃跳過本程序的產生，重啟後清掉同一筆評語', async () => {
    const context = fixture()
    const { walle, entered } = mockWalle(() => new Promise(() => {}))
    const { timers } = controlCommentTimers()
    let now = Date.now()
    const clock = () => new Date(now)
    const liveApp = context.makeApp({ clock, timers, walle })
    expect((await sendCommentRequest(context, liveApp)).status).toBe('committed')
    await entered
    const { committed_at: committedAt } = await readOperation(context.client, context.request.op_id)
    now = committedAt.getTime() + 601000

    await startBackgroundJobs(liveApp, { jobs: createBackgroundJobList() }).stop()
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
    await liveApp.close()

    const restartedApp = context.makeApp({ clock, timers })
    await startBackgroundJobs(restartedApp, { jobs: createBackgroundJobList() }).stop()
    expect(await commentRow(context.client, context.target)).toMatchObject({
      generation_status: 'failed',
      generation_error: '產生中斷，請重按產生',
    })
  })
})
