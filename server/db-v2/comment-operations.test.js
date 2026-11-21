import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commentRow, lockComment, requestComment, saveComment } from './test-support/comments.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const texts = { observation: '觀察紀錄', comment: '人工評語', motto: '箴言' }

describeDatabase('老師的評語操作', () => {
  const database = useTestDatabase()

  it('評語新建完整收據，鎖定後手改也只更新送來的文字', async () => {
    const { client } = database()
    const target = await addClass(client)
    const create = saveComment(target, texts)
    const first = await commitOperation(client, create)
    expect(first.changes).toEqual([{
      entity: 'comment', key: { student_id: target.studentId, semester: create.payload.semester },
      prev_rev: 0, rev: 1, last_op_id: create.op_id, prev_value: null,
      value: {
        ...texts, comment_locked: false, motto_locked: false, generation_status: 'idle',
        generation_error: null, analysis: null, model: null, suggestion: null,
      },
    }])
    expect(await commentRow(client, target)).toMatchObject({
      ...texts, locked_comment: false, locked_motto: false, generation_status: 'idle', rev: 1,
    })
    await commitOperation(client, lockComment(target, undefined, { rev: 1 }))
    const update = await commitOperation(client, saveComment(target, { comment: '更新評語' }, { rev: 2 }))
    expect(update.changes[0]).toMatchObject({
      prev_rev: 2, rev: 3, prev_value: { comment: '人工評語' }, value: { comment: '更新評語' },
    })
    expect(update.changes[0].value).toEqual({ comment: '更新評語' })
    const row = await commentRow(client, target)
    expect(row).toMatchObject({ ...texts, comment: '更新評語', locked_comment: true, locked_motto: true, rev: 3 })
    const repeat = await commitOperation(client, saveComment(target, { comment: '更新評語' }, { rev: 3 }))
    expect(repeat.result.noop).toBe(true)
    expect(await commentRow(client, target)).toEqual(row)
  })

  it.each([
    ['缺少學生', (op) => { op.payload.student_id = randomUUID() }, 'NOT_FOUND'],
    ['學期格式錯誤', (op) => { op.payload.semester = '115-3' }, 'INVALID_PAYLOAD'],
    ['未帶文字欄位', (op) => { delete op.payload.comment }, 'INVALID_PAYLOAD'],
    ['評語超過 2000 字', (op) => { op.payload.comment = '文'.repeat(2001) }, 'INVALID_PAYLOAD'],
    ['多餘鍵', (op) => { op.payload.extra = true }, 'INVALID_PAYLOAD'],
    ['缺少版本條件', (op) => { delete op.expect }, 'INVALID_PAYLOAD'],
  ])('手動存檔拒絕%s', async (_name, change, code) => {
    const { client } = database()
    const target = await addClass(client)
    const op = saveComment(target)
    change(op)
    expect(await submit(client, op)).toMatchObject({ code })
    expect(await commentRow(client, target)).toBeUndefined()
  })

  it('版本不符回六欄現值，各學期獨立保存與推進版本', async () => {
    const { client } = database()
    const target = await addClass(client)
    const nextSemester = { ...target, semester: '115-2' }
    await commitOperation(client, saveComment(target, texts))
    await commitOperation(client, saveComment(nextSemester, { observation: '下學期的觀察' }))
    const stale = await submit(client, saveComment(target))
    expect(stale).toMatchObject({ code: 'STALE_STATE', current: { rev: 1 } })
    expect(stale.current.value).toEqual({
      ...texts, comment_locked: false, motto_locked: false, generation_status: 'idle',
    })
    await commitOperation(client, saveComment(target, { observation: '新觀察' }, { rev: 1 }))
    expect(await commentRow(client, target)).toMatchObject({ observation: '新觀察', rev: 2 })
    expect(await commentRow(client, nextSemester)).toMatchObject({ observation: '下學期的觀察', rev: 1 })
  })

  it('鎖定可建立空白評語、完整設定兩個旗標、解鎖及同值', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, lockComment(target))
    expect(await commentRow(client, target)).toMatchObject({
      observation: '', comment: '', motto: '', locked_comment: true, locked_motto: true, rev: 1,
    })
    const unlocked = { comment_locked: false, motto_locked: false }
    await commitOperation(client, lockComment(target, unlocked, { rev: 1 }))
    const before = await commentRow(client, target)
    expect(before).toMatchObject({ locked_comment: false, locked_motto: false, rev: 2 })
    const repeat = await commitOperation(client, lockComment(target, unlocked, { rev: 2 }))
    expect(repeat.result.noop).toBe(true)
    expect(await commentRow(client, target)).toEqual(before)
    await commitOperation(client, lockComment(target, undefined, { rev: 2 }))
    expect(await commentRow(client, target)).toMatchObject({ locked_comment: true, locked_motto: true, rev: 3 })
    expect(await submit(client, lockComment(target, unlocked, { rev: 2 }))).toMatchObject({ code: 'STALE_STATE' })
    expect(await submit(client, lockComment(target, { ...unlocked, motto_locked: 1 }, { rev: 3 })))
      .toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('產生請求保留文字，進入產生中，重複請求保留版本和成立收據', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, saveComment(target, texts))
    const request = requestComment(target, { rev: 1 })
    const receipt = await commitOperation(client, request)
    expect(receipt.changes).toEqual([expect.objectContaining({
      entity: 'comment', prev_rev: 1, rev: 2,
      prev_value: { generation_status: 'idle' }, value: { generation_status: 'generating' },
    })])
    const before = await commentRow(client, target)
    expect(before).toMatchObject({ ...texts, generation_status: 'generating', rev: 2 })
    const repeat = await commitOperation(client, requestComment(target, { after_op: request.op_id }))
    expect(repeat.result.noop).toBe(true)
    expect(repeat.changes[0]).toMatchObject({ prev_rev: 2, rev: 2, prev_value: {}, value: {} })
    expect(await commentRow(client, target)).toEqual(before)
  })

  it('沒有評語列時可以用 rev 0 請求產生', async () => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await commitOperation(client, requestComment(target))
    expect(receipt.changes[0]).toMatchObject({ prev_rev: 0, rev: 1, value: { generation_status: 'generating' } })
    expect(await commentRow(client, target)).toMatchObject({ generation_status: 'generating', rev: 1 })
  })

  it.each([
    ['全鎖', true, true, 1, 'COMMENT_LOCKED'],
    ['只鎖評語', true, false, 1, 'OK'],
    ['只鎖箴言', false, true, 1, 'OK'],
    ['全鎖且版本過期', true, true, 0, 'STALE_STATE'],
  ])('產生請求在%s時維持檢查順序', async (_name, commentLocked, mottoLocked, rev, code) => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, lockComment(target, { comment_locked: commentLocked, motto_locked: mottoLocked }))
    const before = await commentRow(client, target)
    expect(await submit(client, requestComment(target, { rev }))).toMatchObject({ code })
    const after = await commentRow(client, target)
    if (code === 'OK') {
      expect(after).toMatchObject({ generation_status: 'generating', rev: 2 })
    } else {
      expect(after).toEqual(before)
    }
  })
})
