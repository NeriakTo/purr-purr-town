import { describe, expect, test } from 'vitest'
import { addAgentTask } from '../db-v2/test-support/agent-fixtures.js'
import { holdAgentBatch } from '../db-v2/test-support/agent-held.js'
import { authorizeAgent } from '../db-v2/test-support/agent.js'
import { batchUndo, ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { updateClassInfo } from '../db-v2/test-support/class-student-group.js'
import { adjustment, submit, teacher as fixtureTeacher } from '../db-v2/test-support/operations.js'
import { setStatus } from '../db-v2/test-support/submissions.js'
import { addLegacyTransaction } from '../db-v2/test-support/transactions.js'
import { createTestClass, createTestSession, createTestTeacher } from './test-support/fixtures.js'
import { commitReadOperation, readEntities } from './test-support/read-entities.js'
import { readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'
import { testClassReadBoundaries, testReadIsolation } from './test-support/read-boundaries.js'

function getChanges(context, since_seq, options) {
  return sendRead(context, 'changes', { class_id: context.target.classId, since_seq }, options)
}

async function requestChanges(context, sinceSeq, options) {
  const response = await getChanges(context, sinceSeq, options)
  expect(response.statusCode).toBe(200)
  return response.json()
}

async function readState(context, options) {
  const response = await sendRead(context, 'state', { class_id: context.target.classId }, options)
  expect(response.statusCode).toBe(200)
  return response.json()
}

async function makeAgentContext(context, count) {
  const { client } = context
  const target = await createTestClass(client, { students: Array(count).fill('enrolled') })
  await authorizeAgent(client, target.classId)
  const token = await createTestSession(client, fixtureTeacher.id, { expiresAt: new Date('2027-02-01') })
  return { ...context, target, token, teacher: fixtureTeacher }
}

function expectReceiptRow(rows, { entity, key, rev, value }) {
  const row = rows.find(candidate => candidate.entity === entity && JSON.stringify(candidate.key) === JSON.stringify(key))
  expect(row, entity).toEqual({ entity, key, rev, value: expect.objectContaining(value) })
  expect(row.value).not.toHaveProperty('class_id')
  expect(row.value).not.toHaveProperty('last_op_id')
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('增量版本列與快照', () => {
  const fixture = useReadFixtures()
  testClassReadBoundaries(fixture, [['changes', class_id => ({ class_id, since_seq: 1 })]])
  testReadIsolation(fixture, 'changes', context => getChanges(context, 1))

  test.each(readEntities)('%s 的增量版本列與收據逐欄一致', async (entity, _table, generate) => {
    const context = fixture()
    const { client, target, teacher } = context
    await commitReadOperation(client, adjustment(target), teacher)
    const { class_seq: sinceSeq } = await readState(context)
    expect(sinceSeq).toBeGreaterThan(0)
    const op = entity === 'class' ? updateClassInfo(target.classId) : await generate(client, target, teacher)
    const receipt = await commitReadOperation(client, op, teacher)
    expect(receipt.changes.map(change => change.entity)).toContain(entity)
    const result = await requestChanges(context, sinceSeq)
    expect(result).toMatchObject({ full: false, class_seq: receipt.class_seq })
    for (const change of receipt.changes) expectReceiptRow(result.rows, change)
  })

  test('暫緩沒有序號，序號未變仍帶待確認', async () => {
    const context = await makeAgentContext(fixture(), 6)
    const { client, target } = context
    const targets = await addAgentTask(client, target, -5)
    const { class_seq: sinceSeq } = await readState(context)
    const ops = targets.map(student => setStatus(student, 'missing'))
    await holdAgentBatch(client, target.classId, ops)
    const result = await requestChanges(context, sinceSeq)
    expect(result).toMatchObject({ full: false, class_seq: sinceSeq, operations: [], transactions: [] })
    expect(result.rows).toEqual([expect.objectContaining({
      entity: 'confirmation', key: { confirmation_id: ops[0].op_id },
      value: expect.objectContaining({ kind: 'agent_held', status: 'pending' }),
    })])
  })

  test('整批撤銷帶回復的帳戶、內部撤銷交易及所有成立操作', async () => {
    const context = await makeAgentContext(fixture(), 2)
    const { client, teacher, target } = context
    const { batch } = await ruleBatch(client, 2, target)
    const { class_seq: sinceSeq } = await readState(context)
    const outer = batchUndo(target.classId, batch.call_id, 2)
    const receipt = await commitReadOperation(client, outer, teacher)
    const innerIds = receipt.result.items.map(item => item.undo_op_id)
    const result = await requestChanges(context, sinceSeq)
    expect(result).toMatchObject({ full: false, class_seq: receipt.class_seq })
    expect(result.rows).toHaveLength(2)
    for (const student_id of target.studentIds) {
      expect(result.rows).toContainEqual({
        entity: 'account', key: { student_id }, rev: 3, value: { balance: 0, total_earned: 0 },
      })
    }
    expect(result.operations.map(row => row.op_id)).toEqual([outer.op_id, ...innerIds.toReversed()])
    expect(result.transactions.map(row => row.op_id)).toEqual(innerIds.toReversed())
  })

  test('同序號的版本、交易與操作排除，拒絕與匯入也排除', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const first = await commitReadOperation(client, updateClassInfo(target.classId), teacher)
    const op = adjustment(target)
    const next = await commitReadOperation(client, op, teacher)
    const denied = await submit(client, adjustment({ ...target, studentId: '測試不存在學生' }), teacher)
    expect(denied.status).toBe('rejected')
    await addLegacyTransaction(client, target)
    const before = await readWriteBaseline(client)
    const result = await requestChanges(context, first.class_seq)
    expect(result.rows).toEqual(next.changes.map(({ entity, key, rev, value }) => ({ entity, key, rev, value })))
    expect(result.transactions).toMatchObject([{ op_id: op.op_id, class_seq: next.class_seq }])
    expect(result.operations).toMatchObject([{ op_id: op.op_id, class_seq: next.class_seq }])
    expect(await requestChanges(context, next.class_seq)).toMatchObject({ rows: [], transactions: [], operations: [] })
    expect(await readWriteBaseline(client)).toEqual(before)
  })

  test.each(['state', 'changes'])('%s 快照讀序號後提交，下一次增量帶帳戶與交易', async endpoint => {
    const context = fixture()
    const { client, target, teacher } = context
    const seed = await commitReadOperation(client, adjustment(target, 1), teacher)
    const previous = await commitReadOperation(client, adjustment(target, 11), teacher)
    const op = adjustment(target, 13)
    let committed
    const app = context.makeApp({ hooks: {
      async duringRead() {
        committed = await commitReadOperation(client, op, teacher)
      },
    } })
    const snapshot = endpoint === 'state'
      ? await readState(context, { app })
      : await requestChanges(context, seed.class_seq, { app })
    expect(snapshot.class_seq).toBe(previous.class_seq)
    expectReceiptRow(snapshot.rows, previous.changes[0])
    const result = await requestChanges(context, snapshot.class_seq)
    expect(result.class_seq).toBe(committed.class_seq)
    expectReceiptRow(result.rows, committed.changes[0])
    expect(result.transactions).toMatchObject([{ op_id: op.op_id, amount: 13, class_seq: committed.class_seq }])
  })

  test('序號是零、超前或超過門檻時回整班，恰好門檻仍回增量', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const app = context.makeApp({ config: { read: { changesFullThreshold: 3 } } })
    for (let index = 0; index < 5; index++) await commitReadOperation(client, adjustment(target), teacher)
    const state = await readState(context, { app })
    for (const sinceSeq of [0, state.class_seq + 1, state.class_seq - 4]) {
      expect(await requestChanges(context, sinceSeq, { app })).toEqual({ ...state, full: true })
    }
    expect(await requestChanges(context, state.class_seq - 3, { app })).toMatchObject({
      full: false, operations: Array.from({ length: 3 }, () => expect.any(Object)),
    })
  })

  test('序號為零的匯入班重讀仍可取得匯入版本列', async () => {
    const context = fixture()
    const state = await readState(context)
    expect(state.class_seq).toBe(0)
    expect(state.rows).toContainEqual(expect.objectContaining({ entity: 'student' }))
    for (let index = 0; index < 2; index++) {
      expect(await requestChanges(context, 0)).toEqual({ ...state, full: true })
    }
  })

  test.each([0, 100001, 0.5, '500', null])('門檻設定 %s 不合法時拒絕建立 app', value => {
    expect(() => fixture().makeApp({ config: { read: { changesFullThreshold: value } } })).toThrow(RangeError)
  })

  test.each([undefined, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    '不合法 since_seq（%s）優先於班級檢查且無寫入', async sinceSeq => {
      const context = fixture()
      const { client, target } = context
      const foreign = await createTestClass(client, { owner: createTestTeacher() })
      const before = await readWriteBaseline(client)
      for (const class_id of [target.classId, foreign.classId, '測試缺班']) {
        const response = await sendRead(context, 'changes', { class_id, since_seq: sinceSeq })
        expect(response.statusCode).toBe(400)
        expect(response.body).toBe('{"error":{"code":"BAD_ENVELOPE"}}')
      }
      expect(await readWriteBaseline(client)).toEqual(before)
    },
  )
})
