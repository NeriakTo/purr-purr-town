import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { createClass } from '../db-v2/test-support/class-create.js'
import { adjustment } from '../db-v2/test-support/operations.js'
import { operation } from '../db-v2/test-support/schoolwork.js'
import { createTestClass, createTestSession, createTestTeacher } from './test-support/fixtures.js'
import {
  assertNoOperationTransactions, assertNoWrites, envelope, readOperation, retry, sendOps, useOpsFixtures,
} from './test-support/ops.js'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('提交操作的信封與權限', () => {
  const fixture = useOpsFixtures()

  test('整份信封不符一律回 BAD_ENVELOPE，前面有效的操作也不寫入', async () => {
    const context = fixture()
    const { client, target } = context
    const op = adjustment(target)
    const valid = envelope(target.classId, [op])
    const oversizedPayload = { ...adjustment(target), payload: { text: '貓'.repeat(22000) } }
    const cases = [
      ['非物件', '[]'], ['不支援的版本', { ...valid, v: '1' }],
      ['沒有班級', { ...valid, class_id: undefined }], ['空班級', { ...valid, class_id: '' }],
      ['非字串班級', { ...valid, class_id: 1 }],
      ['空批次編號', { ...valid, batch_id: '' }], ['非字串批次編號', { ...valid, batch_id: 1 }],
      ['沒有操作陣列', { ...valid, ops: {} }], ['空操作陣列', { ...valid, ops: [] }],
      ['超過 50 筆', { ...valid, ops: Array.from({ length: 51 }, () => adjustment(target)) }],
      ['單筆非物件', { ...valid, ops: [op, []] }],
      ['payload 超過 UTF-8 上限', { ...valid, ops: [op, oversizedPayload] }],
      ['重複字串編號', { ...valid, ops: [op, op] }],
    ]
    for (const [label, body] of cases) {
      const response = await sendOps(context, body)
      expect(response.statusCode, label).toBe(400)
      expect(response.json(), label).toEqual({ error: { code: 'BAD_ENVELOPE' } })
      await assertNoWrites(client, target.classId)
    }
  })

  test('缺少編號和重複的非字串編號逐筆回 INVALID_OP_ID', async () => {
    const context = fixture()
    const { client, target } = context
    const op = adjustment(target)
    const response = await sendOps(context, envelope(target.classId, [
      { ...op, op_id: undefined }, { ...op, op_id: 1 }, { ...op, op_id: 1 },
    ]))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts).toEqual(Array.from({ length: 3 }, () => retry(null, 'INVALID_OP_ID')))
    await assertNoWrites(client, target.classId)
  })

  test('沒帶或帶過期權杖都回 401 且班級無寫入', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const body = envelope(target.classId, [adjustment(target)])
    const expired = await createTestSession(client, teacher.id, { expiresAt: new Date('2026-01-01') })
    for (const [token, code] of [[null, 'AUTH_REQUIRED'], [expired, 'AUTH_EXPIRED']]) {
      const response = await sendOps(context, body, { token })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ error: { code } })
      await assertNoWrites(client, target.classId)
    }
  })

  test('別人的班和不存在的班逐位元組同回 403 且無寫入', async () => {
    const context = fixture()
    const { client, target } = context
    const other = await createTestClass(client, { owner: createTestTeacher() })
    const absent = randomUUID()
    const ops = [adjustment(target)]
    const foreign = await sendOps(context, envelope(other.classId, ops))
    const missing = await sendOps(context, envelope(absent, ops))
    expect(foreign.statusCode).toBe(403)
    expect(missing.statusCode).toBe(403)
    expect(foreign.rawPayload).toEqual(missing.rawPayload)
    expect(foreign.json()).toEqual({ error: { code: 'CLASS_FORBIDDEN' } })
    await assertNoWrites(client, target.classId, other.classId, absent)
  })

  test('操作只採登入老師與請求層的班級和批次，保留用戶端中繼資料', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const other = await createTestClass(client, { owner: createTestTeacher() })
    const actor = { kind: 'system', id: 'system' }
    const op = {
      ...adjustment(target), class_id: other.classId, batch_id: '操作內批次', actor, kind: 'system',
      client_time: '2026-11-21T07:59:15Z', client_seq: 7,
    }
    const response = await sendOps(context, envelope(target.classId, [op], {
      batch_id: '請求批次', actor, kind: 'system',
    }))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0]).toMatchObject({ status: 'committed' })
    expect(await readOperation(client, op.op_id)).toMatchObject({
      actor_kind: 'teacher', actor_id: teacher.id, class_id: target.classId, batch_id: '請求批次',
      client_time: op.client_time, client_seq: op.client_seq,
    })
    await assertNoWrites(client, other.classId)
  })

  test('老師冒填系統身分送 OP-47 仍定案拒絕 FORBIDDEN_ROLE', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const actor = { kind: 'system', id: 'system' }
    const op = { ...operation(target.classId, 'comment.apply_generated', {}), actor }
    const response = await sendOps(context, envelope(target.classId, [op], { actor }))
    expect(response.statusCode).toBe(200)
    const { receipts } = response.json()
    expect(receipts[0]).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_ROLE' })
    expect(await readOperation(client, op.op_id)).toMatchObject({
      actor_kind: 'teacher', actor_id: teacher.id, receipt: receipts[0], class_seq: null,
    })
    await assertNoOperationTransactions(client, op.op_id)
  })

  test('只放行首次建班且信封和 payload 班級相同，成立後授予呼叫者擁有權', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const foreign = await createTestClass(client, { owner: createTestTeacher() })
    const create = createClass()
    const { class_id: classId } = create
    const body = envelope(classId, [create])
    const mismatched = randomUUID()
    const forbiddenRequests = [
      envelope(classId, [adjustment(target), create]),
      envelope(mismatched, [create]),
      envelope(foreign.classId, [createClass(0, foreign.classId)]),
    ]
    for (const payload of forbiddenRequests) {
      const response = await sendOps(context, payload)
      expect(response.statusCode).toBe(403)
      expect(response.body).toBe('{"error":{"code":"CLASS_FORBIDDEN"}}')
    }
    await assertNoWrites(client, classId, mismatched, foreign.classId, target.classId)
    const noAuth = await sendOps(context, body, { token: null })
    expect(noAuth.statusCode).toBe(401)
    expect(noAuth.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
    await assertNoWrites(client, classId)
    const success = await sendOps(context, body)
    expect(success.statusCode).toBe(200)
    expect(success.json()).toMatchObject({ class_seq: 1, receipts: [{ status: 'committed', code: 'OK' }] })
    const { rows } = await client.query('SELECT teacher_id FROM ppt.class_ownership WHERE class_id = $1', [classId])
    expect(rows).toEqual([{ teacher_id: teacher.id }])
  })
})
