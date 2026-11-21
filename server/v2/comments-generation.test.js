import { EventEmitter } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, test, vi } from 'vitest'
import { commentRow, requestComment, saveComment } from '../db-v2/test-support/comments.js'
import { adjustment, submit } from '../db-v2/test-support/operations.js'
import { buildV2App } from './app.js'
import { createTestClass } from './test-support/fixtures.js'
import {
  captureCommentLog, commentApplications, controlCommentTimers, generated, mockWalle, names, observation,
  readCommentApplication, sendCommentRequest, useCommentFixtures,
} from './test-support/comment-jobs.js'

const timeoutError = '評語產生逾時，請重按產生'
const badResult = '產生結果不符格式，請重按產生'
const walleError = '評語產生失敗，請重按產生'
const disabledError = '評語產生功能尚未啟用'
const errorMarker = 'WALLE-ERROR-MARKER-4c1d'

function expectSafeLogs(entries, token) {
  const output = JSON.stringify(entries)
  for (const value of [token, ...names, observation, ...Object.values(generated), errorMarker]) {
    expect(output).not.toContain(value)
  }
  for (const entry of entries) {
    expect(Object.keys(entry).every(key => [
      'level', 'time', 'job', 'date', 'code', 'count', 'class_id', 'request_op_id',
    ].includes(key))).toBe(true)
  }
}

async function expectFailed(fixture, expected) {
  expect(await commentRow(fixture.client, fixture.target)).toMatchObject({
    generation_status: 'failed', generation_error: expected,
  })
  expect((await readCommentApplication(fixture)).payload.error).toBe(expected)
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('後端評語產生', () => {
  const fixture = useCommentFixtures()

  test('成立的請求經系統身分套用，編號等於資料庫算法，成功紀錄不帶私密資料', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ walle, logger })
    expect((await sendCommentRequest(context, app)).status).toBe('committed')
    await app.whenIdle()
    expect(await commentRow(context.client, context.target)).toMatchObject({
      generation_status: 'idle', comment: names[0] + '互助，13號也是',
      motto: names[0] + '測試箴言', analysis: names[0] + '測試分析',
    })
    const { rows: [{ id }] } = await context.client.query('SELECT ppt.comment_apply_op_id($1) AS id', [context.request.op_id])
    expect(await readCommentApplication(context)).toMatchObject({ op_id: id, actor_kind: 'system', status: 'committed' })
    expect(entries).toEqual([expect.objectContaining({ job: 'comment_generation', code: 'OK', count: 1 })])
    expectSafeLogs(entries, context.token)
  })

  test('瓦力只收到四個鍵，三種姓名拼法及轉出與封存學生均已遮名', async () => {
    const context = fixture()
    await context.client.query(
      "UPDATE ppt.comments SET locked_motto = 'true' WHERE class_id = $1", [context.target.classId],
    )
    const { walle } = mockWalle()
    const app = context.makeApp({ walle })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    const [[input]] = walle.mock.calls
    expect(input).toEqual({
      observation: '觀察測試記號，3號／3號／3號／3號／7號／7號／7號／7號／9號／9號／9號／12號／12號／12號／15號／15號／15號',
      student_label: '3號', comment_locked: false, motto_locked: true,
    })
    const spaces = '\u0009\u000A\u000B\u000C\u000D\u0020\u0085\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000'
    function normalize(value) {
      return [...value.toLowerCase()].filter(character => !spaces.includes(character)).join('')
    }
    const serialized = normalize(JSON.stringify(input))
    for (const name of names) {
      const spelling = [...normalize(name)]
      for (const part of [spelling, spelling.slice(1), spelling.slice(-2)]) {
        expect(serialized).not.toContain(part.join(''))
      }
    }
    for (const id of [context.target.classId, ...context.target.studentIds]) expect(serialized).not.toContain(id)
  })

  test('提交之後才同步發動，HTTP 回應不等待瓦力', async () => {
    const context = fixture()
    const hold = Promise.withResolvers()
    const { walle, entered } = mockWalle(() => hold.promise)
    const beforeCommit = vi.fn(() => expect(onGenerationTrigger).not.toHaveBeenCalled())
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, hooks: { beforeCommit, onGenerationTrigger } })
    try {
      expect((await sendCommentRequest(context, app)).status).toBe('committed')
      expect(beforeCommit).toHaveBeenCalledTimes(1)
      expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
      expect(onGenerationTrigger).toHaveBeenCalledWith({
        class_id: context.target.classId, request_op_id: context.request.op_id,
      })
      await entered
      expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
    } finally {
      hold.resolve(generated)
    }
    await app.whenIdle()
  })

  test('提交交易回滾時不發動、不呼叫瓦力', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const onGenerationTrigger = vi.fn()
    const beforeCommit = () => { throw new Error('測試回滾') }
    const app = context.makeApp({ walle, hooks: { onGenerationTrigger, beforeCommit } })
    expect(await sendCommentRequest(context, app)).toMatchObject({ status: 'retry', code: 'INTERNAL_ERROR' })
    await app.whenIdle()
    expect(onGenerationTrigger).not.toHaveBeenCalled()
    expect(walle).not.toHaveBeenCalled()
  })

  test('發動拋錯時保留成立回應，只記允許的錯誤欄位', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const { logger, entries } = captureCommentLog()
    const onGenerationTrigger = () => { throw new Error(errorMarker) }
    const app = context.makeApp({ walle, logger, hooks: { onGenerationTrigger } })
    expect((await sendCommentRequest(context, app)).status).toBe('committed')
    await app.whenIdle()
    expect(walle).not.toHaveBeenCalled()
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
    expect(entries).toEqual([expect.objectContaining({
      job: 'comment_generation', code: 'INTERNAL_ERROR', class_id: context.target.classId, request_op_id: context.request.op_id,
    })])
    expectSafeLogs(entries, context.token)
  })

  test('同一請求重送不再發動', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, hooks: { onGenerationTrigger } })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    expect(await sendCommentRequest(context, app)).toMatchObject({ replayed: true })
    await app.whenIdle()
    expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
    expect(walle).toHaveBeenCalledTimes(1)
  })

  test('定案拒絕的 OP-46 不發動', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, hooks: { onGenerationTrigger } })
    const rejected = requestComment(context.target, { rev: 99 })
    expect(await sendCommentRequest(context, app, rejected)).toMatchObject({ status: 'rejected', code: 'STALE_STATE' })
    await app.whenIdle()
    expect(onGenerationTrigger).not.toHaveBeenCalled()
    expect(walle).not.toHaveBeenCalled()
  })

  test('產生中的新請求即使不改資料也會發動', async () => {
    const context = fixture()
    expect((await submit(context.client, context.request, context.teacher)).status).toBe('committed')
    const next = requestComment(context.target, { rev: 2 })
    const { walle } = mockWalle()
    const app = context.makeApp({ walle })
    expect(await sendCommentRequest(context, app, next)).toMatchObject({ status: 'committed', result: { noop: true } })
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    expect((await commentRow(context.client, context.target)).generation_status).toBe('idle')
  })

  test('連按兩次同一學生與學期只呼叫一次瓦力、套用一次', async () => {
    const context = fixture()
    const hold = Promise.withResolvers()
    const duplicate = Promise.withResolvers()
    const { walle, entered } = mockWalle(() => {
      if (walle.mock.calls.length > 1) duplicate.resolve()
      return hold.promise
    })
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, hooks: { onGenerationTrigger } })
    try {
      await sendCommentRequest(context, app)
      expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
      await entered
      const trigger = vi.spyOn(app.commentGeneration, 'trigger')
      const next = requestComment(context.target, { rev: 2 })
      expect(await sendCommentRequest(context, app, next)).toMatchObject({ status: 'committed', result: { noop: true } })
      expect(onGenerationTrigger).toHaveBeenCalledTimes(2)
      await Promise.race([trigger.mock.results[0].value, duplicate.promise])
      expect(walle).toHaveBeenCalledTimes(1)
    } finally {
      hold.resolve(generated)
    }
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    expect(await commentApplications(context)).toHaveLength(1)
  })

  test('計時器到期取消瓦力並套用固定逾時結果，紀錄不帶私密資料', async () => {
    const context = fixture()
    const { walle, entered } = mockWalle(() => new Promise(() => {}))
    const { timers, pending, expire } = controlCommentTimers()
    const { logger, entries } = captureCommentLog()
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, timers, logger, hooks: { onGenerationTrigger }, config: { comments: { timeoutMs: 1234 } } })
    await sendCommentRequest(context, app)
    expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
    const signal = await entered
    expect(timers.setTimeout.mock.calls).toEqual([[expect.any(Function), 1234]])
    expire()
    await app.whenIdle()
    expect(signal.aborted).toBe(true)
    expect(pending.size).toBe(0)
    await expectFailed(context, timeoutError)
    expect(entries).toHaveLength(1)
    expectSafeLogs(entries, context.token)
  }, 3000)

  const invalid = [
    ['評語超過 2000 字', { comment: '評'.repeat(2001) }],
    ['箴言超過 200 字', { motto: '箴'.repeat(201) }],
    ['分析超過 5000 字', { analysis: '析'.repeat(5001) }],
    ['模型名稱超過 100 字', { model: '模'.repeat(101) }],
    ['模型名稱為空', { model: '' }],
    ['分析型別不符', { analysis: 7 }],
    ['含有 U+0000', { comment: '產生輸出\0' }],
    ['含有未成對的代理字元', { comment: '產生輸出\uD800' }],
    ['還原姓名後超過 2000 字', { comment: '3號'.repeat(501) }],
    ['輸出多出第五個鍵', { extra: '輸出多出的測試欄位' }],
  ]

  test.each(invalid)('瓦力輸出不合格時套用固定錯誤並保護紀錄：%s', async (_, fields) => {
    const context = fixture()
    const { walle } = mockWalle(() => ({ ...generated, ...fields }))
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ walle, logger })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    await expectFailed(context, badResult)
    expect(entries).toHaveLength(1)
    expectSafeLogs(entries, context.token)
    for (const value of Object.values(fields).filter(value => typeof value === 'string' && value.length)) {
      expect(JSON.stringify(entries)).not.toContain(value)
    }
  })

  test('2000 個表情符號按 Unicode 字元計算且能寫入', async () => {
    const context = fixture()
    const comment = '🐾'.repeat(2000)
    const { walle } = mockWalle(() => ({ ...generated, comment }))
    const app = context.makeApp({ walle })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    expect(await commentRow(context.client, context.target)).toMatchObject({ generation_status: 'idle', comment })
  })

  test('瓦力丟錯只套用固定字句，資料庫與紀錄無原始錯誤', async () => {
    const context = fixture()
    const { walle } = mockWalle(() => { throw new Error(errorMarker) })
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ walle, logger })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    await expectFailed(context, walleError)
    expect(JSON.stringify(await readCommentApplication(context))).not.toContain(errorMarker)
    expect(JSON.stringify(await commentRow(context.client, context.target))).not.toContain(errorMarker)
    expect(entries).toHaveLength(1)
    expectSafeLogs(entries, context.token)
  })

  test('未注入瓦力時套用未啟用的固定錯誤', async () => {
    const context = fixture()
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ logger })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    await expectFailed(context, disabledError)
    expect(entries).toHaveLength(1)
    expectSafeLogs(entries, context.token)
  })

  test('老師等待期間手改，晚到的評語只寫成建議稿', async () => {
    const context = fixture()
    const hold = Promise.withResolvers()
    const { walle, entered } = mockWalle(() => hold.promise)
    const onGenerationTrigger = vi.fn()
    const app = context.makeApp({ walle, hooks: { onGenerationTrigger } })
    try {
      await sendCommentRequest(context, app)
      expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
      await entered
      const edit = saveComment(context.target, { observation: '更正後的觀察測試文字', comment: '人工修改的測試評語' }, { rev: 2 })
      expect((await sendCommentRequest(context, app, edit)).status).toBe('committed')
      expect(onGenerationTrigger).toHaveBeenCalledTimes(1)
    } finally {
      hold.resolve(generated)
    }
    await app.whenIdle()
    expect((await readCommentApplication(context)).receipt.result.superseded).toBe(true)
    expect(await commentRow(context.client, context.target)).toMatchObject({
      observation: '更正後的觀察測試文字', comment: '人工修改的測試評語',
      suggestion: { comment: names[0] + '互助，13號也是' },
    })
  })

  test('評語對象只取同班且已成立的 OP-46 操作紀錄', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ walle, logger })
    const other = adjustment(context.target)
    const rejected = requestComment(context.target, { rev: 99 })
    const otherClass = await createTestClass(context.client, { owner: context.teacher })
    expect((await submit(context.client, context.request, context.teacher)).status).toBe('committed')
    expect((await submit(context.client, other, context.teacher)).status).toBe('committed')
    expect((await submit(context.client, rejected, context.teacher)).status).toBe('rejected')

    const wrongClass = { class_id: otherClass.classId, request_op_id: context.request.op_id }
    const wrongType = { class_id: context.target.classId, request_op_id: other.op_id }
    const notCommitted = { class_id: context.target.classId, request_op_id: rejected.op_id }
    for (const invalidTarget of [wrongClass, wrongType, notCommitted]) {
      app.commentGeneration.trigger({ ...invalidTarget, student_id: context.target.studentId, semester: '115-1' })
    }
    await app.whenIdle()
    expect(walle).not.toHaveBeenCalled()
    expect(await commentApplications(context)).toHaveLength(0)
    expect(entries).toHaveLength(3)
    for (const invalidTarget of [wrongClass, wrongType, notCommitted]) {
      expect(entries).toContainEqual(expect.objectContaining({ ...invalidTarget, code: 'NOT_FOUND' }))
    }

    // 同學生同學期、payload 也帶 student_id 與 semester 的 OP-44，拿掉類型條件時才會讀到評語列並呼叫瓦力
    const saved = saveComment(context.target, { comment: '不是產生請求的存檔' }, { rev: 2 })
    expect((await submit(context.client, saved, context.teacher)).status).toBe('committed')
    const sameTargetOtherType = { class_id: context.target.classId, request_op_id: saved.op_id }
    app.commentGeneration.trigger({ ...sameTargetOtherType, student_id: context.target.studentId, semester: '115-1' })
    await app.whenIdle()
    expect(walle).not.toHaveBeenCalled()
    expect(entries).toHaveLength(4)
    expect(entries).toContainEqual(expect.objectContaining({ ...sameTargetOtherType, code: 'NOT_FOUND' }))

    app.commentGeneration.trigger({
      class_id: context.target.classId, request_op_id: context.request.op_id, student_id: other.op_id, semester: '999-1',
    })
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    expect((await readCommentApplication(context)).payload).toMatchObject({
      student_id: context.target.studentId, semester: '115-1',
    })
  })

  test('已成立的 OP-46 若紀錄指向別班學生也不呼叫瓦力', async () => {
    const context = fixture()
    const other = await createTestClass(context.client, { owner: context.teacher })
    expect((await submit(context.client, saveComment(other), context.teacher)).status).toBe('committed')
    expect((await submit(context.client, context.request, context.teacher)).status).toBe('committed')
    await context.client.query(
      "UPDATE ppt.operations SET payload = jsonb_set(payload, '{student_id}', to_jsonb($2::text)) WHERE op_id = $1",
      [context.request.op_id, other.studentId],
    )
    const { walle } = mockWalle()
    const { logger, entries } = captureCommentLog()
    const app = context.makeApp({ walle, logger })
    app.commentGeneration.trigger({ class_id: context.target.classId, request_op_id: context.request.op_id })
    await app.whenIdle()
    expect(walle).not.toHaveBeenCalled()
    expect(await commentApplications(context)).toHaveLength(0)
    expect(entries).toEqual([expect.objectContaining({ code: 'NOT_FOUND', request_op_id: context.request.op_id })])
  })

  test('暫時失敗依注入等待重送，三次使用同一個編號與內容', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const observed = []
    const beforeServerCommit = vi.fn(op => {
      observed.push(structuredClone(op))
      if (observed.length < 3) throw new Error('測試暫時失敗')
    })
    const sleep = vi.fn(async () => {})
    const app = context.makeApp({ walle, sleep, hooks: { beforeServerCommit } })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    expect(walle).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls).toEqual([[1000], [2000]])
    expect(observed).toEqual([observed[0], observed[0], observed[0]])
    expect((await readCommentApplication(context)).status).toBe('committed')
  })

  test('暫時失敗用完重送後保留產生中，只記一行交給清掃', async () => {
    const context = fixture()
    const { walle } = mockWalle()
    const { logger, entries } = captureCommentLog()
    const beforeServerCommit = vi.fn(() => { throw new Error(errorMarker) })
    const sleep = vi.fn(async () => {})
    const app = context.makeApp({ walle, sleep, logger, hooks: { beforeServerCommit } })
    await sendCommentRequest(context, app)
    await app.whenIdle()
    expect(beforeServerCommit).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]])
    expect(await readCommentApplication(context)).toBeUndefined()
    expect((await commentRow(context.client, context.target)).generation_status).toBe('generating')
    expect(entries).toEqual([expect.objectContaining({
      job: 'comment_generation', code: 'INTERNAL_ERROR', class_id: context.target.classId, request_op_id: context.request.op_id,
    })])
    expectSafeLogs(entries, context.token)
  })
})

test('建 app 拒絕超出範圍的評語逾時、重送與瓦力設定', async () => {
  const pool = new EventEmitter()
  for (const comments of [
    { timeoutMs: 999 }, { timeoutMs: 600001 }, { timeoutMs: '1000' }, { timeoutMs: null },
    { retryDelaysMs: null }, { retryDelaysMs: [-1] }, { retryDelaysMs: [60001] },
    { retryDelaysMs: [0, 0, 0, 0, 0, 0] }, { retryDelaysMs: [1.2] }, { retryDelaysMs: Array(1) },
  ]) {
    expect(() => buildV2App({ pool, config: { comments } })).toThrow(RangeError)
  }
  expect(() => buildV2App({ pool, walle: '測試錯誤設定' })).toThrow(RangeError)
  const app = buildV2App({ pool, config: { comments: { timeoutMs: 600000, retryDelaysMs: [0, 60000], sweepAfterMs: 800000 } } })
  await app.close()
})

test('新版來源沒有外部模型連線或前端匯入', async () => {
  const root = new URL('./', import.meta.url)
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const forbidden = [/\bfetch\s*\(/u, /['"](?:node:)?https?['"]/u, /['"][^'"\n]*\/src\//u]
  for (const file of entries.filter(entry => entry.isFile() && /\.js$/u.test(entry.name) && !/\.test\.js$/u.test(entry.name))) {
    const path = file.parentPath + '/' + file.name
    const source = await readFile(path, 'utf8')
    for (const pattern of forbidden) expect(source, path).not.toMatch(pattern)
  }
})
