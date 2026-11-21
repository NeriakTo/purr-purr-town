import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { buildV2App } from './app.js'
import { startBackgroundJobs } from './jobs/background-jobs.js'

function controlTimers() {
  const pending = new Map()
  let nextId = 0
  const timers = {
    setTimeout: vi.fn((callback, delay) => {
      const id = ++nextId
      pending.set(id, { callback, delay })
      return id
    }),
    clearTimeout: vi.fn(id => pending.delete(id)),
  }
  function runNext() {
    const [[id, { callback }]] = pending
    pending.delete(id)
    return callback()
  }
  return { timers, pending, runNext }
}

function makeContext(time = '2026-11-15T15:55:00Z') {
  const { timers, pending, runNext } = controlTimers()
  const app = { log: { error: vi.fn() } }
  const clock = () => new Date(time)
  function start(jobs, config) {
    return startBackgroundJobs(app, { jobs, config, clock, timers })
  }
  return { start, timers, pending, runNext, log: app.log }
}

async function letRoundFinish() {
  // 等背景工作的 Promise 鏈清空，無須經過真實時間。
  await new Promise(resolve => setImmediate(resolve))
}

test('啟動立即依清單順序跑完一輪', async () => {
  const { start, timers } = makeContext()
  const order = []
  const jobs = [
    { name: 'first', async run() { order.push('first') } },
    { name: 'second', async run() { order.push('second') } },
  ]
  const running = start(jobs)
  try {
    expect(order).toEqual(['first'])
    await letRoundFinish()
    expect(order).toEqual(['first', 'second'])
    expect(timers.setTimeout).toHaveBeenCalledTimes(1)
  } finally {
    await running.stop()
  }
})

test('臺灣 23:55 排十分鐘、00:03 排七分鐘且 00:10 排常規間隔', async () => {
  for (const [time, expected] of [
    ['2026-11-15T15:55:00Z', 600000],
    ['2026-11-15T16:03:00Z', 420000],
    ['2026-11-15T16:10:00Z', 600000],
  ]) {
    const { start, timers } = makeContext(time)
    const running = start([])
    try {
      await letRoundFinish()
      expect(timers.setTimeout.mock.calls).toEqual([[expect.any(Function), expected]])
    } finally {
      await running.stop()
    }
  }
})

test('工作失敗只記工作名與安全錯誤碼並繼續當輪與下一輪', async () => {
  const { start, runNext, log } = makeContext()
  const afterFailure = vi.fn()
  const running = start([
    { name: 'failing', run() { throw Object.assign(new Error('測試敏感內容'), { code: 'TEST_SECRET' }) } },
    { name: 'following', run: afterFailure },
  ])
  try {
    await letRoundFinish()
    expect(afterFailure).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls).toEqual([[{ job: 'failing', code: 'INTERNAL_ERROR' }]])
    await runNext()
    expect(afterFailure).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledTimes(2)
  } finally {
    await running.stop()
  }
})

test('工作放行之前不安排下一輪，放行後採用自訂間隔', async () => {
  const { start, timers } = makeContext()
  const { promise, resolve } = Promise.withResolvers()
  const running = start([{ name: 'waiting', run: () => promise }], { jobs: { intervalMs: 60000 } })
  try {
    await letRoundFinish()
    expect(timers.setTimeout).not.toHaveBeenCalled()
    resolve()
    await letRoundFinish()
    expect(timers.setTimeout.mock.calls).toEqual([[expect.any(Function), 60000]])
  } finally {
    resolve()
    await running.stop()
  }
})

test('停止會等進行中的一輪且不再安排計時器', async () => {
  const { start, timers } = makeContext()
  const { promise, resolve } = Promise.withResolvers()
  const second = vi.fn()
  const stopped = vi.fn()
  const running = start([{ name: 'waiting', run: () => promise }, { name: 'second', run: second }])
  const stopping = running.stop().then(stopped)
  try {
    await letRoundFinish()
    expect(stopped).not.toHaveBeenCalled()
  } finally {
    resolve()
    await stopping
  }
  expect(second).toHaveBeenCalledTimes(1)
  expect(stopped).toHaveBeenCalledTimes(1)
  expect(timers.setTimeout).not.toHaveBeenCalled()
})

test('停止會清除已排定的計時器且可重複呼叫', async () => {
  const { start, pending, timers } = makeContext()
  const running = start([])
  await letRoundFinish()
  expect(pending.size).toBe(1)
  await running.stop()
  await running.stop()
  expect(pending.size).toBe(0)
  expect(timers.clearTimeout.mock.calls).toEqual([[1]])
})

function makeUnusedPool() {
  return Object.assign(new EventEmitter(), { connect: vi.fn(), query: vi.fn() })
}

test('建 app 與查詢不存在的路徑不啟動工作，顯式啟動才使用注入的計時器', async () => {
  const { timers } = controlTimers()
  const pool = makeUnusedPool()
  const config = { allowedOrigins: [], jobs: { intervalMs: 60000 } }
  const app = buildV2App({ pool, config, clock: () => new Date('2026-11-15T15:55:00Z'), timers })
  try {
    expect((await app.inject('/missing')).statusCode).toBe(404)
    expect(timers.setTimeout).not.toHaveBeenCalled()
    const running = startBackgroundJobs(app, { jobs: [] })
    try {
      await letRoundFinish()
      expect(timers.setTimeout.mock.calls).toEqual([[expect.any(Function), 60000]])
    } finally {
      await running.stop()
    }
  } finally {
    await app.close()
  }
  expect(pool.connect).not.toHaveBeenCalled()
  expect(pool.query).not.toHaveBeenCalled()
  expect(timers.clearTimeout.mock.calls).toEqual([[1]])
})

test('建 app 與啟動工作都拒絕超出範圍或型別不符的設定', async () => {
  const day = 86400000
  const { start, timers } = makeContext()
  const pool = makeUnusedPool()
  for (const config of [
    { jobs: { intervalMs: 59999 } }, { jobs: { intervalMs: 3600001 } },
    { jobs: { intervalMs: 60000.5 } }, { jobs: { intervalMs: '60000' } },
    { cleanup: { sessionRetentionMs: day - 1 } }, { cleanup: { sessionRetentionMs: 366 * day } },
    { cleanup: { busyCountRetentionMs: day - 1 } }, { cleanup: { busyCountRetentionMs: null } },
    { cleanup: { busyCountRetentionMs: 365 * day + 1 } },
  ]) {
    expect(() => buildV2App({ pool, config })).toThrow(RangeError)
    expect(() => start([], config)).toThrow(RangeError)
  }
  expect(() => buildV2App({ pool, timers: { setTimeout() {} } })).toThrow(RangeError)
  expect(() => startBackgroundJobs({ log: {} }, { timers: null })).toThrow(RangeError)
  expect(timers.setTimeout).not.toHaveBeenCalled()
  expect(pool.connect).not.toHaveBeenCalled()
})

test('啟動入口在 listen 後接線且關池前等待背景工作停止', async () => {
  const source = await readFile(new URL('index.js', import.meta.url), 'utf8')
  expect(source).toMatch(/await app\.listen\([^\n]+\n\s*\w+ = startBackgroundJobs\(/)
  expect(source).toMatch(/app\.addHook\('onClose',[^}]*await \w+\?\.stop\(\)[^}]*await pool\.end\(\)/)
})
