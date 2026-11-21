import { randomBytes, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, test, vi } from 'vitest'
import { classSnapshot } from '../db-v2/test-support/checks.js'
import { adjustment, classSequence } from '../db-v2/test-support/operations.js'
import { createTask, saveRule, updateTask } from '../db-v2/test-support/schoolwork.js'
import { addSubmission, addTask } from '../db-v2/test-support/submissions.js'
import { createTestClass, createTestTeacher } from './test-support/fixtures.js'
import { commitReadOperation, readEntities } from './test-support/read-entities.js'
import { readTestTime, readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'

const forbiddenBody = Buffer.from('{"error":{"code":"CLASS_FORBIDDEN"}}')
const classIdFormats = [
  ['第 4 版', randomUUID],
  ['64 字元', () => randomBytes(32).toString('hex')],
]
const classEndpoints = [['state', class_id => ({ class_id })]]

function matchReceiptRow(rows, change) {
  const { entity, key, rev, value } = change
  const actual = rows.find(row => row.entity === entity && isDeepStrictEqual(row.key, key))
  expect(actual, JSON.stringify({ entity, key })).toEqual({ entity, key, rev, value: expect.any(Object) })
  expect(actual.value).not.toHaveProperty('class_id')
  expect(actual.value).not.toHaveProperty('last_op_id')
  for (const [field, expected] of Object.entries(value)) {
    expect(actual.value, field).toHaveProperty(field)
    expect(actual.value[field], field).toEqual(expected)
  }
  return actual
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('整班版本列與快照', () => {
  const fixture = useReadFixtures()

  test.each(readEntities)('%s 的整班版本列與操作收據逐欄一致', async (entity, _table, makeOperation) => {
    const context = fixture()
    const { client, teacher, target } = context
    const op = await makeOperation(client, target, teacher)
    const receipt = await commitReadOperation(client, op, teacher)
    expect(receipt.changes.map(change => change.entity)).toContain(entity)

    const response = await sendRead(context, 'state', { class_id: op.class_id })
    expect(response.statusCode).toBe(200)
    const { rows, class_seq } = response.json()
    expect(class_seq).toBe(receipt.class_seq)
    for (const change of receipt.changes) matchReceiptRow(rows, change)
  })

  test('作業修改的收據只帶差異，整班仍帶齊作業欄位', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const created = await commitReadOperation(client, createTask(target.classId), teacher)
    const initial = created.changes.find(row => row.entity === 'task')
    const op = updateTask(target.classId, initial.key.task_id, { title: '測試作業改名' })
    const { changes: [change] } = await commitReadOperation(client, op, teacher)
    expect(change.value).toEqual({ title: '測試作業改名' })

    const response = await sendRead(context, 'state', { class_id: target.classId })
    expect(response.statusCode).toBe(200)
    const row = matchReceiptRow(response.json().rows, change)
    expect(row.value).toEqual({ ...initial.value, ...change.value })
  })

  test('規則只帶同一班同一規則的目前版本', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const op = saveRule(target.classId)
    await commitReadOperation(client, op, teacher)
    const modified = saveRule(target.classId, { ...op.payload, name: '測試新版規則', amount: -3 }, 1)
    const { changes: [change] } = await commitReadOperation(client, modified, teacher)

    const response = await sendRead(context, 'state', { class_id: target.classId })
    expect(response.statusCode).toBe(200)
    const rows = response.json().rows.filter(row => row.entity === 'rule')
    expect(rows).toHaveLength(1)
    matchReceiptRow(rows, change)
  })

  test('不參與的繳交照常帶回並保留版本', async () => {
    const context = fixture()
    const { client, target } = context
    const { classId, studentId } = target
    const taskId = await addTask(client, classId)
    await addSubmission(client, { ...target, taskId }, { active: false, rev: 3 })

    const response = await sendRead(context, 'state', { class_id: classId })
    expect(response.statusCode).toBe(200)
    expect(response.json().rows).toContainEqual({
      entity: 'submission',
      key: { task_id: taskId, student_id: studentId },
      rev: 3,
      value: { status: 'pending', assignment_active: false },
    })
  })

  test('班級序號是數字，版本列依實體及鍵排序，重讀不寫入', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    await commitReadOperation(client, adjustment(target), teacher)
    const high = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const low = '00000000-0000-4000-8000-000000000000'
    for (const id of [high, low]) {
      await commitReadOperation(client, createTask(target.classId, { task_id: id }), teacher)
    }
    const before = await readWriteBaseline(client)
    const payload = { class_id: target.classId, teacher_id: '忽略本文身分' }
    const first = await sendRead(context, 'state', payload)
    const second = await sendRead(context, 'state', payload)
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.rawPayload).toEqual(first.rawPayload)
    const { server_time, class_seq, rows } = first.json()
    expect(server_time).toBe(readTestTime)
    expect(class_seq).toBe(await classSequence(client, target.classId))
    const keys = rows.map(row => row.entity + JSON.stringify(row.key))
    expect(keys).toEqual([...keys].sort())
    expect(await readWriteBaseline(client)).toEqual(before)
  })

  test('讀取序號後提交 OP-24，序號、帳戶版本與餘額仍是同一個快照', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const before = await commitReadOperation(client, adjustment(target, 11), teacher)
    let committed
    const app = context.makeApp({
      hooks: {
        async duringRead() {
          committed = await commitReadOperation(client, adjustment(target, 13), teacher)
        },
      },
    })
    const response = await sendRead(context, 'state', { class_id: target.classId }, { app })
    expect(response.statusCode).toBe(200)
    const { class_seq, rows } = response.json()
    expect(class_seq).toBe(before.class_seq)
    matchReceiptRow(rows, before.changes.find(change => change.entity === 'account'))
    expect(committed.class_seq).toBe(before.class_seq + 1)
    expect(await classSequence(client, target.classId)).toBe(committed.class_seq)
  })

  test('快照先設唯讀隔離與本地參數，再以班級序號取得快照', async () => {
    const context = fixture()
    const connection = await context.pool.connect()
    const query = vi.spyOn(connection, 'query')
    connection.release()
    function duringRead() {
      expect(query.mock.calls.at(-1)[0]).toMatch(/SELECT\s+class_seq\s+FROM ppt\.classes/i)
    }
    const app = context.makeApp({ config: { statementTimeoutMs: 1234 }, hooks: { duringRead } })
    try {
      const response = await sendRead(context, 'state', { class_id: context.target.classId }, { app })
      expect(response.statusCode).toBe(200)
      const statements = query.mock.calls.map(([sql]) => sql.trim())
      const begin = statements.findIndex(sql => sql.startsWith('BEGIN'))
      expect(begin).toBeGreaterThanOrEqual(0)
      expect(statements.slice(begin, begin + 5)).toEqual([
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        'SET LOCAL statement_timeout = 1234',
        "SET LOCAL timezone = 'UTC'",
        "SET LOCAL datestyle = 'ISO, YMD'",
        expect.stringMatching(/^SELECT\s+class_seq\s+FROM ppt\.classes\s+WHERE class_id = \$1/i),
      ])
    } finally {
      query.mockRestore()
    }
  })

  describe.each(classEndpoints)('%s 的班級檢查', (endpoint, makeBody) => {
    test.each(classIdFormats)('%s 編號的別班與缺班同回 403，本文逐位元組相同且無寫入', async (_format, makeId) => {
      const context = fixture()
      const { client } = context
      const foreign = makeId()
      const missing = makeId()
      await createTestClass(client, { classId: foreign, owner: createTestTeacher() })
      const before = await readWriteBaseline(client)
      const foreignBefore = await classSnapshot(client, foreign)

      for (const classId of [foreign, missing]) {
        const response = await sendRead(context, endpoint, makeBody(classId))
        expect(response.statusCode).toBe(403)
        expect(response.rawPayload).toEqual(forbiddenBody)
      }
      expect(await classSnapshot(client, foreign)).toBe(foreignBefore)
      expect(await readWriteBaseline(client)).toEqual(before)
    })
  })

  test.each([
    ['沒有本文', undefined],
    ['本文是陣列', []],
    ['本文是 null', 'null'],
    ['缺 class_id', {}],
    ['class_id 是空字串', { class_id: '' }],
    ['class_id 是數字', { class_id: 42 }],
  ])('信封的 %s 在班級檢查之前回 400 且無寫入', async (_label, body) => {
    const context = fixture()
    const before = await readWriteBaseline(context.client)
    const response = await sendRead(context, 'state', body)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    expect(await readWriteBaseline(context.client)).toEqual(before)
  })
})
