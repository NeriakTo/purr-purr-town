import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { setClassStatus } from './test-support/class-student-group.js'
import {
  applyComment, commentApplyId, commentRow, generatedComment, lockComment, requestComment, saveComment, system,
} from './test-support/comments.js'
import { addClass, adjustment, cancel, operationCount, submit } from './test-support/operations.js'
import { authorizeScheduler, overdueOperation, scheduler } from './test-support/scheduler.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const texts = { observation: '人工觀察', comment: '人工評語', motto: '人工箴言' }

async function generationFixture(client, locks) {
  const target = await addClass(client)
  const saved = await commitOperation(client, saveComment(target, texts))
  let rev = saved.changes[0].rev
  if (locks) {
    const locked = await commitOperation(client, lockComment(target, locks, { rev }))
    rev = locked.changes[0].rev
  }
  const request = requestComment(target, { rev })
  const receipt = await commitOperation(client, request)
  return { target, request, rev: receipt.changes[0].rev }
}

async function submitGenerated(client, op) {
  const receipt = await submit(client, op, system)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

describeDatabase('系統評語套用', () => {
  const database = useTestDatabase()

  it.each([
    ['固定身分', system],
    ['不同 id', { kind: 'system', id: 'fixture' }],
    ['缺少 id', { kind: 'system' }],
    ['多餘鍵', { ...system, extra: true }],
    ['放棄', system],
  ])('系統身分驗證%s', async (name, actor) => {
    const { client } = database()
    const { rows: [{ actor: actual }] } = await client.query('SELECT ppt.system_actor() AS actor')
    expect(actual).toEqual(system)
    const target = await addClass(client)
    const op = applyComment(target, randomUUID())
    const count = await operationCount(client)
    if (name === '固定身分') {
      expect(await submit(client, op, actor)).toMatchObject({ status: 'rejected', code: 'NOT_FOUND' })
      expect(await operationCount(client)).toBe(count + 1)
    } else if (name === '放棄') {
      await expect(cancel(client, target.classId, op.op_id, actor)).rejects.toMatchObject({ code: '22023' })
      expect(await operationCount(client)).toBe(count)
    } else {
      await expect(submit(client, op, actor)).rejects.toMatchObject({ code: '22023' })
      expect(await operationCount(client)).toBe(count)
    }
  })

  it.each([
    ['第 4 版編號', (op) => { op.op_id = randomUUID() }],
    ['非推導所得的第 5 版編號', (op) => { op.op_id = commentApplyId(randomUUID()) }],
    ['非字串請求編號', (op) => { op.payload.request_op_id = 1 }],
  ])('OP-47 拒絕%s且不登記', async (_name, mutate) => {
    const { client } = database()
    const target = await addClass(client)
    const op = applyComment(target, randomUUID())
    mutate(op)
    const count = await operationCount(client)
    expect(await submit(client, op, system)).toEqual({
      op_id: op.op_id, status: 'retry', code: 'INVALID_OP_ID',
    })
    expect(await operationCount(client)).toBe(count)
  })

  it('固定對照值與二十個隨機請求的 UUID v5 由資料庫和 Node 獨立核對', async () => {
    const { client } = database()
    const fixed = '11111111-1111-4111-8111-111111111111'
    expect(commentApplyId(fixed)).toBe('71f1c2cd-fdbc-585f-bf80-5c7865910a03')
    const requests = [fixed, ...Array.from({ length: 20 }, () => randomUUID())]
    const { rows } = await client.query(
      'SELECT ppt.comment_apply_op_id(request_id) AS id FROM unnest($1::text[]) AS request_id', [requests],
    )
    expect(rows.map(({ id }) => id)).toEqual(requests.map(commentApplyId))
  })

  it.each([
    ['系統送 OP-24', (target) => adjustment(target), system],
    ['系統送 OP-44', (target) => saveComment(target), system],
    ['系統送 OP-52', ({ classId }) => overdueOperation(classId, '2026-11-21'), system],
    ['老師送 OP-47', (target) => applyComment(target, randomUUID()), undefined],
    ['排程送 OP-47', (target) => applyComment(target, randomUUID()), scheduler],
  ])('%s 只留下 FORBIDDEN_ROLE', async (_name, makeOperation, actor) => {
    const { client } = database()
    const target = await addClass(client)
    if (actor === scheduler) await authorizeScheduler(client, target.classId)
    const op = makeOperation(target)
    if (actor === system) op.op_id = commentApplyId(randomUUID())
    if (actor === undefined) op.op_id = randomUUID()
    const before = await classSnapshot(client, target.classId)
    const count = await operationCount(client)
    expect(await submit(client, op, actor)).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_ROLE' })
    expect(await operationCount(client)).toBe(count + 1)
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  it('小野送 OP-47 回保存的 FORBIDDEN_ROLE', async () => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const op = { ...applyComment(target, randomUUID()), op_id: randomUUID() }
    const before = await classSnapshot(client, target.classId)
    const count = await operationCount(client)
    const batch = await agentSubmit(client, target.classId, [op])
    expect(batch.receipts[0]).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_ROLE' })
    expect(await operationCount(client)).toBe(count + 1)
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  it('系統查不到班級時不登記，封存班級則保存拒絕', async () => {
    const { client } = database()
    const target = await addClass(client)
    const count = await operationCount(client)
    const missing = applyComment({ ...target, classId: randomUUID() }, randomUUID())
    expect(await submit(client, missing, system)).toEqual({
      op_id: missing.op_id, status: 'retry', code: 'CLASS_FORBIDDEN',
    })
    expect(await operationCount(client)).toBe(count)
    await commitOperation(client, setClassStatus(target.classId, 'archived'))
    expect(await submit(client, applyComment(target, randomUUID()), system))
      .toMatchObject({ status: 'rejected', code: 'CLASS_ARCHIVED' })
  })

  it('無系統授權列也能套用結果、記錄系統身分，重送不增加版本', async () => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client)
    const op = applyComment(target, request.op_id)
    const receipt = await submitGenerated(client, op)
    expect(receipt.result).toEqual({
      noop: false, transactions: [], effects_added: [], effects_reversed: [],
      superseded: false, written: ['comment', 'motto'],
    })
    const next = { ...generatedComment, generation_status: 'idle' }
    expect(receipt.changes).toEqual([expect.objectContaining({
      entity: 'comment', key: { student_id: target.studentId, semester: op.payload.semester },
      prev_rev: rev, rev: rev + 1, value: next,
    })])
    expect(receipt.changes[0].value).toEqual(next)
    expect(await commentRow(client, target)).toMatchObject({
      ...next, observation: texts.observation, generation_error: null, rev: rev + 1,
    })
    const { rows } = await client.query(
      'SELECT actor_kind, actor_id FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    expect(rows).toEqual([{ actor_kind: 'system', actor_id: 'system' }])
    expect(await submit(client, op, system)).toEqual({ ...receipt, replayed: true })
    expect((await commentRow(client, target)).rev).toBe(rev + 1)
  })

  it.each([
    ['comment', 'motto', { comment_locked: true, motto_locked: false }],
    ['motto', 'comment', { comment_locked: false, motto_locked: true }],
  ])('鎖定的 %s 保持原文，只寫 %s', async (locked, written, flags) => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client, flags)
    const receipt = await submitGenerated(client, applyComment(target, request.op_id))
    expect(receipt.result).toMatchObject({ superseded: false, written: [written] })
    expect(receipt.changes[0].value).not.toHaveProperty(locked)
    expect(await commentRow(client, target)).toMatchObject({
      [locked]: texts[locked], [written]: generatedComment[written], rev: rev + 1,
    })
  })

  it.each([
    ['老師手改文字', (target, rev) => saveComment(target, { comment: '老師改過的評語' }, { rev })],
    ['老師只改鎖定', (target, rev) => lockComment(target, undefined, { rev })],
  ])('%s之後只存建議稿，保留人工文字與旗標', async (_name, makeEdit) => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client)
    await commitOperation(client, makeEdit(target, rev))
    const before = await commentRow(client, target)
    const receipt = await submitGenerated(client, applyComment(target, request.op_id))
    const suggestion = { request_op_id: request.op_id, ...generatedComment }
    expect(receipt.result).toMatchObject({ superseded: true, written: [] })
    expect(receipt.changes[0].value).toEqual({ suggestion, generation_status: 'idle' })
    expect(await commentRow(client, target)).toEqual({
      ...before, suggestion, generation_status: 'idle', rev: before.rev + 1, last_op_id: receipt.op_id,
    })
  })

  it('產生失敗保留文字，下一次請求清空錯誤', async () => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client)
    const error = '測試產生失敗'
    const receipt = await submitGenerated(client, applyComment(target, request.op_id, { error }))
    expect(receipt.result).toMatchObject({ superseded: false, written: [] })
    expect(receipt.changes[0].value).toEqual({ generation_status: 'failed', generation_error: error })
    expect(await commentRow(client, target)).toMatchObject({
      ...texts, generation_status: 'failed', generation_error: error, rev: rev + 1,
    })
    const retry = await commitOperation(client, requestComment(target, { rev: rev + 1 }))
    expect(retry.changes[0].value).toEqual({ generation_status: 'generating', generation_error: null })
  })

  it('過期的產生失敗只結束產生中，列未變時保留版本', async () => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client)
    const second = requestComment(target, { rev })
    await commitOperation(client, second)
    await commitOperation(client, saveComment(target, { comment: '人工更新' }, { rev }))
    const failure = { error: '過期的錯誤' }
    const first = await submitGenerated(client, applyComment(target, request.op_id, failure))
    expect(first.result).toMatchObject({ superseded: true, written: [], noop: false })
    expect(first.changes[0].value).toEqual({ generation_status: 'idle' })
    const before = await commentRow(client, target)
    expect(before).toMatchObject({ comment: '人工更新', generation_error: null, suggestion: null })
    const repeat = await submitGenerated(client, applyComment(target, second.op_id, failure))
    expect(repeat.result).toMatchObject({ superseded: true, written: [], noop: true })
    expect(repeat.changes[0]).toMatchObject({ prev_rev: before.rev, rev: before.rev, value: {} })
    expect(await commentRow(client, target)).toEqual(before)
  })

  it.each([
    ['同時帶結果與錯誤', { ...generatedComment, error: '測試錯誤' }],
    ['沒有結果也沒有錯誤', {}],
  ])('套用拒絕%s', async (_name, fields) => {
    const { client } = database()
    const { target, request } = await generationFixture(client)
    expect(await submit(client, applyComment(target, request.op_id, fields), system))
      .toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
  })

  it.each([
    ['不存在', () => randomUUID()],
    ['另一班', async (client) => (await generationFixture(client)).request.op_id],
    ['操作種類不同', async (client, target) => (await commitOperation(client, saveComment(target))).op_id],
    ['已遭拒絕', async (client, target) => {
      await commitOperation(client, lockComment(target))
      const receipt = await submit(client, requestComment(target, { rev: 1 }))
      expect(receipt.code).toBe('COMMENT_LOCKED')
      return receipt.op_id
    }],
    ['學生不同', async (client, target) => {
      const receipt = await commitOperation(client, requestComment({ ...target, studentId: target.studentIds[1] }))
      return receipt.op_id
    }],
    ['學期不同', async (client, target) => {
      const receipt = await commitOperation(client, requestComment({ ...target, semester: '115-2' }))
      return receipt.op_id
    }],
  ])('請求%s時回 NOT_FOUND 且不洩漏現值', async (_name, requestId) => {
    const { client } = database()
    const target = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const id = await requestId(client, target)
    const before = await classSnapshot(client, target.classId)
    const receipt = await submit(client, applyComment(target, id), system)
    expect(receipt).toMatchObject({ status: 'rejected', code: 'NOT_FOUND' })
    expect(receipt).not.toHaveProperty('current')
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  it('兩筆請求以收據版本比較，先到套用、後到只存建議稿', async () => {
    const { client } = database()
    const { target, request, rev } = await generationFixture(client)
    const second = requestComment(target, { rev })
    const requested = await commitOperation(client, second)
    expect(requested.result.noop).toBe(true)
    const first = await submitGenerated(client, applyComment(target, request.op_id))
    expect(first.result.superseded).toBe(false)
    const later = { ...generatedComment, comment: '後到的產生評語' }
    const result = await submitGenerated(client, applyComment(target, second.op_id, later))
    expect(result.result).toMatchObject({ superseded: true, written: [] })
    expect(await commentRow(client, target)).toMatchObject({
      comment: generatedComment.comment, suggestion: { request_op_id: second.op_id, ...later },
    })
  })

  it('兩連線競爭十次，任何已成立的手改都受到保護', async () => {
    const { client, connect } = database()
    const other = await connect()
    for (let round = 0; round < 10; round += 1) {
      const { target, request, rev } = await generationFixture(client)
      const manual = saveComment(target, { comment: '並行手改的評語' }, { rev })
      const generated = applyComment(target, request.op_id)
      const [edited, applied] = await Promise.all([
        submit(client, manual), submitGenerated(other, generated),
      ])
      const row = await commentRow(client, target)
      if (edited.code === 'OK') {
        expect(applied.result).toMatchObject({ superseded: true, written: [] })
        expect(row.comment).toBe(manual.payload.comment)
      } else {
        expect(edited.code).toBe('STALE_STATE')
        expect(applied.result.superseded).toBe(false)
        expect(row.comment).toBe(generatedComment.comment)
      }
    }
  })
})
