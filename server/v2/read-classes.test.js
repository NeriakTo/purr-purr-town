import { describe, expect, test } from 'vitest'
import { createClass } from '../db-v2/test-support/class-create.js'
import { hashSessionToken } from './auth/session.js'
import { createTestClass, createTestSession, createTestTeacher } from './test-support/fixtures.js'
import { envelope, sendOps } from './test-support/ops.js'
import { readTestTime, readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'

const endpoints = [
  ['classes', () => undefined],
  ['state', ({ target }) => ({ class_id: target.classId })],
]

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('班級清單與讀取驗證', () => {
  const fixture = useReadFixtures()

  test('班級清單只列權杖老師擁有的班，依編號排序並保留封存班', async () => {
    const context = fixture()
    const { client, teacher } = context
    const owned = await createTestClass(client, { owner: teacher })
    await createTestClass(client, { owner: createTestTeacher() })
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [owned.classId])

    const response = await sendRead(context, 'classes', { teacher_id: '忽略本文身分' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      server_time: readTestTime,
      classes: [context.target.classId, owned.classId].sort().map(classId => ({
        class_id: classId,
        value: { status: classId === owned.classId ? 'archived' : 'active' },
      })),
    })
  })

  test('HTTP 建班被定案拒絕後，操作紀錄的班級不出現在清單', async () => {
    const context = fixture()
    const op = createClass(101)
    const submitted = await sendOps(context, envelope(op.class_id, [op]))
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().receipts).toMatchObject([{ status: 'rejected' }])
    const { rowCount } = await context.client.query('SELECT 1 FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(rowCount).toBe(1)

    const response = await sendRead(context, 'classes')
    expect(response.statusCode).toBe(200)
    expect(response.json().classes.map(row => row.class_id)).toEqual([context.target.classId])
  })

  test('清單的班級序號、版本與欄位型別和 HTTP 建班收據一致', async () => {
    const context = fixture()
    const op = createClass()
    const submitted = await sendOps(context, envelope(op.class_id, [op]))
    expect(submitted.statusCode).toBe(200)
    const [receipt] = submitted.json().receipts
    expect(receipt.status).toBe('committed')
    const change = receipt.changes.find(row => row.entity === 'class')
    expect(change.value).toHaveProperty('cutover_date', null)

    const response = await sendRead(context, 'classes')
    expect(response.statusCode).toBe(200)
    const row = response.json().classes.find(row => row.class_id === op.class_id)
    expect(row).toMatchObject({ class_seq: receipt.class_seq, rev: change.rev })
    expect(row.value).toEqual(change.value)
    await context.client.query("UPDATE ppt.classes SET cutover_date = DATE '2026-11-15' WHERE class_id = $1", [op.class_id])
    const updated = await sendRead(context, 'classes')
    expect(updated.json().classes.find(row => row.class_id === op.class_id).value.cutover_date).toBe('2026-11-15')
  })

  test('清單以 JSON 時間帶回最後匯出，無匯出列的班回 null', async () => {
    const context = fixture()
    const { client, teacher, target } = context
    const untouched = await createTestClass(client, { owner: teacher })
    const exportedAt = '2026-11-20T01:02:03.456Z'
    const responseBefore = await sendRead(context, 'classes')
    expect(responseBefore.statusCode).toBe(200)
    await client.query(
      'INSERT INTO ppt_web_state.class_exports (class_id, last_export_at) VALUES ($1, $2)',
      [target.classId, exportedAt],
    )
    const response = await sendRead(context, 'classes')
    expect(response.statusCode).toBe(200)
    const classes = response.json().classes
    const actual = classes.find(row => row.class_id === target.classId).last_export_at
    expect(typeof actual).toBe('string')
    expect(new Date(actual)).toEqual(new Date(exportedAt))
    expect(classes.find(row => row.class_id === untouched.classId).last_export_at).toBeNull()
  })

  test.each(endpoints)('%s 區分缺權杖與過期權杖且資料庫不變', async (endpoint, payload) => {
    const context = fixture()
    const expired = await createTestSession(context.client, context.teacher.id, { expiresAt: new Date(readTestTime) })
    const before = await readWriteBaseline(context.client)
    const missing = await sendRead(context, endpoint, payload(context), { token: null })
    expect(missing.statusCode).toBe(401)
    expect(missing.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
    const stale = await sendRead(context, endpoint, payload(context), { token: expired })
    expect(stale.statusCode).toBe(401)
    expect(stale.json()).toEqual({ error: { code: 'AUTH_EXPIRED' } })
    const malformed = await sendRead(context, endpoint, '{', { token: null })
    expect(malformed.statusCode).toBe(401)
    expect(malformed.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
    expect(await readWriteBaseline(context.client)).toEqual(before)
  })

  test('GAS 的班級清單先標記工作階段，再拒絕解析失敗的 JSON', async () => {
    const context = fixture()
    const relayKey = 'test-relay-'.repeat(3)
    const response = await sendRead(context, 'classes', '{', {
      app: context.makeApp({ config: { relayKey } }),
      headers: { 'x-ppt-relay-key': relayKey },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    const { rows: [session] } = await context.client.query(
      'SELECT first_relayed_at FROM ppt_web_state.sessions WHERE token_hash = $1', [hashSessionToken(context.token)],
    )
    expect(session.first_relayed_at).toEqual(new Date(readTestTime))
  })

  test('同一老師的讀取算入帳號限流，第三次回 429', async () => {
    const context = fixture()
    const app = context.makeApp({ config: { accountRateLimit: 2 } })
    expect((await sendRead(context, 'classes', undefined, { app })).statusCode).toBe(200)
    expect((await sendRead(context, 'classes', undefined, { app })).statusCode).toBe(200)
    const response = await sendRead(context, 'classes', undefined, { app })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })

  test('同一資料的清單重讀結果相同，沒有寫入匯出或操作紀錄', async () => {
    const context = fixture()
    const before = await readWriteBaseline(context.client)
    const first = await sendRead(context, 'classes')
    const second = await sendRead(context, 'classes', {})
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.body).toBe(first.body)
    expect(await readWriteBaseline(context.client)).toEqual(before)
  })
})
