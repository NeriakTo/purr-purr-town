import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { createClass } from '../db-v2/test-support/class-create.js'
import { classSnapshot } from '../db-v2/test-support/checks.js'
import { adjustment } from '../db-v2/test-support/operations.js'
import * as classAccess from './ops/class-access.js'
import { createTestClass, createTestTeacher } from './test-support/fixtures.js'
import { cancelViaHttp, lookupViaHttp } from './test-support/operation-http.js'
import { assertNoOperationWrites, assertNoWrites, envelope, retry, sendOps, useOpsFixtures } from './test-support/ops.js'

const forbiddenBody = '{"error":{"code":"CLASS_FORBIDDEN"}}'
const v4 = '12345678-abcd-4abc-8abc-0123456789ab'
const legacyId = () => randomBytes(32).toString('hex')
const formats = [['第 4 版', randomUUID], ['64 字元', legacyId]]

function expectForbidden(response) {
  expect(response.statusCode).toBe(403)
  expect(response.rawPayload).toEqual(Buffer.from(forbiddenBody))
}

async function makeClassPair({ client }, makeId) {
  const foreign = makeId()
  const missing = makeId()
  await createTestClass(client, { classId: foreign, owner: createTestTeacher() })
  return { foreign, missing }
}

async function expectNoClassWrites(client, foreign, missing, before) {
  await assertNoWrites(client, foreign, missing)
  expect(await classSnapshot(client, foreign)).toBe(before)
  const { rowCount } = await client.query('SELECT 1 FROM ppt.classes WHERE class_id = $1', [missing])
  expect(rowCount).toBe(0)
}

async function expectForbiddenPair(context, makeId, send) {
  const { client } = context
  const { foreign, missing } = await makeClassPair(context, makeId)
  const before = await classSnapshot(client, foreign)
  const existing = await send(foreign)
  const absent = await send(missing)
  expectForbidden(existing)
  expectForbidden(absent)
  expect(existing.rawPayload).toEqual(absent.rawPayload)
  await expectNoClassWrites(client, foreign, missing, before)
}

function sendBatch(context, classId, ops) {
  return sendOps(context, envelope(classId, ops))
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('班級存取的預先檢查', () => {
  const fixture = useOpsFixtures()

  test.each(formats)('首筆非建班時，%s 的別班與缺班同回 403 且無寫入', async (_label, makeId) => {
    const context = fixture()
    await expectForbiddenPair(context, makeId, id => sendBatch(context, id, [adjustment(context.target)]))
  })

  test.each([
    ['有效外觀', op => [op]],
    ['操作編號不是 UUID', op => [{ ...op, op_id: '不是 UUID' }]],
    ['操作編號是第 5 版', op => [{ ...op, op_id: v4.replace('-4abc-', '-5abc-') }]],
    ['承接來源不存在', op => [{ ...op, payload: { ...op.payload, inherit_from_class_id: legacyId() } }]],
    ['另帶非建班操作', (op, target) => [op, adjustment(target)]],
  ])('64 字元編號的建班同回 403 且無寫入，涵蓋%s', async (_label, operations) => {
    const context = fixture()
    await expectForbiddenPair(context, legacyId, id => sendBatch(context, id, operations(createClass(0, id), context.target)))
  })

  test.each([
    ['大寫第 4 版', id => 'AB' + id.toUpperCase().slice(2)],
    ['第 1 版', id => id.slice(0, 14) + '1' + id.slice(15)],
    ['結尾有換行', id => id + '\n'],
  ])('%s 的班級編號無法放行建班', async (_label, modifyId) => {
    const context = fixture()
    await expectForbiddenPair(context, () => modifyId(randomUUID()), id => sendBatch(context, id, [createClass(0, id)]))
  })

  test.each([
    ['建班在第二筆', (id, target) => [adjustment(target), createClass(0, id)]],
    ['建班編號和請求不同', () => [createClass(0)]],
  ])('第 4 版編號在%s時，別班與缺班同回 403 且無寫入', async (_label, operations) => {
    const context = fixture()
    await expectForbiddenPair(context, randomUUID, id => sendBatch(context, id, operations(id, context.target)))
  })

  test.each(formats)('放棄 %s 編號的別班和缺班同回 403 且不登記放棄', async (_label, makeId) => {
    const context = fixture()
    const opId = randomUUID()
    await expectForbiddenPair(context, makeId, id => cancelViaHttp(context, opId, id))
    await assertNoOperationWrites(context.client, opId)
  })

  test.each(formats)('查詢 %s 編號的別班和缺班同回 403', async (_label, makeId) => {
    const context = fixture()
    await expectForbiddenPair(context, makeId, id => lookupViaHttp(context, [randomUUID()], id))
  })

  test('依 2.6 第 3 點預期分得出，未使用的第 4 版編號能建班並取得擁有權', async () => {
    const context = fixture()
    const op = createClass(0)
    const response = await sendBatch(context, op.class_id, [op])
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts).toMatchObject([{ status: 'committed', code: 'OK' }])
    const { rows } = await context.client.query('SELECT teacher_id FROM ppt.class_ownership WHERE class_id = $1', [op.class_id])
    expect(rows).toEqual([{ teacher_id: context.teacher.id }])
  })

  test('依 2.6 第 3 點預期分得出，已被別人使用的第 4 版編號回 403 且無寫入', async () => {
    const context = fixture()
    const { client } = context
    const { foreign, missing } = await makeClassPair(context, randomUUID)
    const before = await classSnapshot(client, foreign)
    expectForbidden(await sendBatch(context, foreign, [createClass(0, foreign)]))
    await expectNoClassWrites(client, foreign, missing, before)
  })

  test('依 2.6 第 3 點預期分得出，未使用的第 4 版編號保留無效操作編號收據', async () => {
    const context = fixture()
    const op = { ...createClass(0), op_id: '無效編號' }
    const response = await sendBatch(context, op.class_id, [op])
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts).toEqual([retry(op.op_id, 'INVALID_OP_ID')])
    await assertNoWrites(context.client, op.class_id)
  })

  test('後端與資料庫逐一判定相同的第 4 版編號格式', async () => {
    const { client } = fixture()
    const inputs = [
      v4, v4.toUpperCase(), v4.replace('-4abc-', '-1abc-'), v4.replace('-4abc-', '-5abc-'),
      v4.replace('-8abc-', '-7abc-'), v4.slice(1), v4 + 'a', legacyId(), v4 + '\n', ' ' + v4, v4 + ' ',
    ]
    await client.query('SET ROLE ppt_owner')
    try {
      const { rows } = await client.query('SELECT ppt.valid_v4_op_id(value) AS valid FROM unnest($1::text[]) AS value', [inputs])
      expect(rows.map(row => row.valid)).toEqual([true, ...Array(inputs.length - 1).fill(false)])
      expect(inputs.map(value => classAccess.isV4ClassId(value))).toEqual(rows.map(row => row.valid))
    } finally {
      await client.query('RESET ROLE')
    }
  })

  test('自己的 64 字元班送建班仍進寫入程序並保留重送結果', async () => {
    const context = fixture()
    const id = legacyId()
    await createTestClass(context.client, { classId: id, owner: context.teacher })
    const op = createClass(0, id)
    const initial = await sendBatch(context, id, [op])
    expect(initial.statusCode).toBe(200)
    expect(initial.json().receipts).toMatchObject([{ status: 'rejected', code: 'ID_CONFLICT' }])
    const repeated = await sendBatch(context, id, [op])
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json().receipts).toEqual([{ ...initial.json().receipts[0], replayed: true }])
  })

  test('新的第 4 版班可以承接自己的 64 字元班', async () => {
    const context = fixture()
    const source = legacyId()
    await createTestClass(context.client, { classId: source, owner: context.teacher })
    const op = createClass(0, randomUUID(), { inherit_from_class_id: source })
    const response = await sendBatch(context, op.class_id, [op])
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts).toMatchObject([{ status: 'committed', code: 'OK' }])
  })

  test('承接別人的舊班與不存在的舊編號同回 CLASS_FORBIDDEN 收據且不登記操作', async () => {
    const context = fixture()
    const { client } = context
    const { foreign, missing } = await makeClassPair(context, legacyId)
    const before = await classSnapshot(client, foreign)
    const newId = randomUUID()
    const op = createClass(0, newId, { inherit_from_class_id: foreign })
    const existing = await sendBatch(context, newId, [op])
    const absent = await sendBatch(context, newId, [{ ...op, payload: { ...op.payload, inherit_from_class_id: missing } }])
    for (const response of [existing, absent]) {
      expect(response.statusCode).toBe(200)
      expect(response.json().receipts).toEqual([retry(op.op_id, 'CLASS_FORBIDDEN')])
    }
    expect(existing.rawPayload).toEqual(absent.rawPayload)
    await assertNoOperationWrites(client, op.op_id)
    await expectNoClassWrites(client, foreign, newId, before)
  })
})
