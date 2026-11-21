import { describe, expect, test } from 'vitest'
import { addAgentClass, addAgentTask, agentCallRow } from '../db-v2/test-support/agent-fixtures.js'
import { holdAgentBatch } from '../db-v2/test-support/agent-held.js'
import { agentSubmit } from '../db-v2/test-support/agent.js'
import { batchUndo, ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { changeRound, createRound } from '../db-v2/test-support/correction-rounds.js'
import { submit, teacher } from '../db-v2/test-support/operations.js'
import { setStatus } from '../db-v2/test-support/submissions.js'
import { undo } from '../db-v2/test-support/undo.js'
import { createTestSession } from './test-support/fixtures.js'
import { commitReadOperation } from './test-support/read-entities.js'
import { readJson } from './test-support/read-json.js'
import { useReadFixtures } from './test-support/read.js'

async function agentContext(context, count) {
  const target = await addAgentClass(context.client, count)
  const token = await createTestSession(context.client, teacher.id, { expiresAt: new Date('2027-02-01') })
  return { ...context, target, teacher, token }
}

function stampBatch(client, callId, instant = '2026-11-22T06:00:00Z') {
  return client.query('UPDATE ppt.agent_calls SET created_at = $2 WHERE call_id = $1', [callId, instant])
}

async function readBatch(context, callId) {
  const { agent_batches: batches } = await readJson(context, 'state')
  const batch = batches.find(row => row.batch_id === callId)
  expect(batch).toBeDefined()
  return batch
}

async function verifyBatchCount(context, callId, count) {
  const { client, target } = context
  const row = await readBatch(context, callId)
  expect(row.op_count).toBe(count)
  const wrong = count > 1 ? [count + 1, count - 1] : [count + 1]
  for (const expected of wrong) {
    expect(await submit(client, batchUndo(target.classId, callId, expected), teacher)).toMatchObject({
      status: 'rejected', code: 'STALE_STATE', current: { op_count: row.op_count },
    })
  }
  if (count > 0) {
    const receipt = await commitReadOperation(client, batchUndo(target.classId, callId, row.op_count), teacher)
    expect(receipt.result.batch.op_count).toBe(count)
  }
  return row
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('小野批次與整批撤銷一致', () => {
  const fixture = useReadFixtures()

  test('暫緩、退回與全拒絕的批次均為零，和 OP-51 相同', async () => {
    const context = await agentContext(fixture(), 6)
    const { client, target } = context
    const students = await addAgentTask(client, target, -5)
    const { batch, reject } = await holdAgentBatch(client, target.classId, students.map(row => setStatus(row, 'missing')))
    await stampBatch(client, batch.call_id)
    expect(await verifyBatchCount(context, batch.call_id, 0)).toMatchObject({
      pending_held: true, seats: [], held_ops: expect.any(Array), undone: false,
    })
    await commitReadOperation(client, reject(), teacher)
    expect(await verifyBatchCount(context, batch.call_id, 0)).toMatchObject({ pending_held: false, held_ops: null })
    const denied = await agentSubmit(client, target.classId, [setStatus(students[0], 'missing', { rev: 8 })])
    expect(denied.receipts[0].status).toBe('rejected')
    await stampBatch(client, denied.call_id)
    await verifyBatchCount(context, denied.call_id, 0)
  })

  test('同值與小野自行撤銷納入筆數，重送與拒絕排除，座號去重排序，撤銷後標記', async () => {
    const context = await agentContext(fixture(), 2)
    const { client, target } = context
    const original = await ruleBatch(client, 1, target)
    const [, student] = await addAgentTask(client, target, -5)
    const first = setStatus(student, 'missing')
    const noop = setStatus(student, 'missing', { rev: 2 })
    const denial = setStatus(student, 'pending', { rev: 9 })
    const selfUndo = undo(target.classId, original.ops[0].op_id)
    const note = '測試同值與自行撤銷批次'
    const batch = await agentSubmit(client, target.classId, [original.ops[0], first, noop, denial, selfUndo], undefined, note)
    expect(batch.receipts.map(row => row.status)).toEqual(['committed', 'committed', 'committed', 'rejected', 'committed'])
    expect(batch.receipts[0].replayed).toBe(true)
    expect(batch.receipts[2].result.noop).toBe(true)
    await stampBatch(client, batch.call_id)
    const row = await verifyBatchCount(context, batch.call_id, 3)
    expect(row).toEqual({
      batch_id: batch.call_id, created_at: expect.any(String), note, op_count: 3,
      seats: [1, 2], pending_held: false, held_ops: null, undone: false,
    })
    expect(new Date(row.created_at)).toEqual(new Date('2026-11-22T06:00:00Z'))
    expect((await readBatch(context, batch.call_id)).undone).toBe(true)
  })

  test('已確認暫緩批次仍是原批次，成立筆數與 OP-51 相同', async () => {
    const context = await agentContext(fixture(), 6)
    const { client, target } = context
    const students = await addAgentTask(client, target, -5)
    const held = await holdAgentBatch(client, target.classId, students.map(row => setStatus(row, 'missing')))
    await stampBatch(client, held.batch.call_id)
    await commitReadOperation(client, held.approve(), teacher)
    expect(await verifyBatchCount(context, held.batch.call_id, 6)).toMatchObject({
      seats: [1, 2, 3, 4, 5, 6], pending_held: false, held_ops: null,
    })
  })

  test('超過七天的批次排除，仍待確認的帶原始 held_ops，批次由新到舊', async () => {
    const context = await agentContext(fixture(), 6)
    const { client, target } = context
    const old = await ruleBatch(client, 1, target)
    const students = await addAgentTask(client, target, -5)
    const held = await holdAgentBatch(client, target.classId, students.map(row => setStatus(row, 'missing')))
    const { classId } = target
    const recent = await agentSubmit(client, classId, [setStatus(students[0], 'missing', { rev: 9 })])
    const future = await agentSubmit(client, classId, [setStatus(students[1], 'missing', { rev: 9 })])
    await stampBatch(client, old.batch.call_id, '2026-11-14T08:00:00Z')
    await stampBatch(client, held.batch.call_id, '2026-11-14T08:00:00Z')
    await stampBatch(client, recent.call_id, '2026-11-21T08:00:00Z')
    await stampBatch(client, future.call_id, '2026-11-22T08:00:01Z')
    const { held_inputs } = await agentCallRow(client, held.batch.call_id)
    const { agent_batches: batches } = await readJson(context, 'state')
    expect(batches.map(row => row.batch_id)).toEqual([recent.call_id, held.batch.call_id])
    expect(batches[1]).toMatchObject({ pending_held: true, held_ops: held_inputs })
  })

  test('小野標記訂正退回由訂正列找出座號，單筆批次筆數與 OP-51 相同', async () => {
    const context = await agentContext(fixture(), 2)
    const { client, target } = context
    const [, student] = await addAgentTask(client, target)
    const round = await createRound(client, student)
    const op = changeRound(round, 'mark_returned', { rev: 1 })
    const batch = await agentSubmit(client, target.classId, [op])
    expect(batch.receipts[0].status).toBe('committed')
    await stampBatch(client, batch.call_id)
    expect(await verifyBatchCount(context, batch.call_id, 1)).toMatchObject({ seats: [2] })
  })
})
