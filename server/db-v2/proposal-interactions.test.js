import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { confirmationsFor, propose } from './test-support/confirmations.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, restoreTask, voidTask } from './test-support/schoolwork.js'
import { assignTask, markSubmission } from './test-support/submission-flow.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function guardedStatus(target, status, flag = true, rev = 1) {
  const op = setStatus(target, status, { rev })
  op.payload.only_if_no_proposal = flag
  return op
}

describeDatabase('繳交操作與提議的交互作用', () => {
  const database = useTestDatabase()

  test('版本通過才查提議，旗標擋下時帶完整 current 且資料不動', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const target = await assignTask(client, { classId, studentId })
    const baseline = await markSubmission(client, target, 'pending')
    const proposal = await commitOperation(client, propose(target, 'late'))
    const snapshot = await classSnapshot(client, classId)
    const stale = await submit(client, guardedStatus(target, 'on_time', true, 8))
    expect(stale).toMatchObject({ code: 'STALE_STATE', current: { rev: 1 } })
    expect(stale.current).not.toHaveProperty('proposal')
    const guarded = await submit(client, guardedStatus(target, 'on_time'))
    expect(guarded).toMatchObject({
      code: 'STALE_STATE',
      current: { value: baseline.changes[0].value, rev: 1 },
    })
    expect(guarded.current.proposal).toEqual({
      confirmation_id: proposal.op_id, proposed_status: 'late', status: 'pending', proposed_at: proposal.committed_at,
    })
    expect(await classSnapshot(client, classId)).toBe(snapshot)
  })

  test('旗標 true 無提議照常成立，旗標 false 真改時取代提議', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    await commitOperation(client, guardedStatus(target, 'on_time'))
    const second = await assignTask(client, target)
    const proposal = await commitOperation(client, propose(second, 'missing'))
    const receipt = await commitOperation(client, guardedStatus(second, 'on_time', false))
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['submission', 'confirmation'])
    expect(receipt.changes[1]).toMatchObject({
      key: { confirmation_id: proposal.op_id }, prev_rev: 1, rev: 2,
      value: { status: 'superseded', processed_op_id: receipt.op_id, processed_at: receipt.committed_at },
    })
  })

  test('同值保留提議且無待確認變更，帶旗標同值仍會被擋', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    const proposal = await commitOperation(client, propose(target, 'on_time'))
    const noop = await markSubmission(client, target, 'pending')
    expect(noop.result.noop).toBe(true)
    expect(noop.changes.map(({ entity }) => entity)).toEqual(['submission'])
    expect(await submit(client, guardedStatus(target, 'pending'))).toMatchObject({ code: 'STALE_STATE' })
    expect(await confirmationsFor(client, target.classId)).toMatchObject([
      { confirmation_id: proposal.op_id, status: 'pending', rev: 1 },
    ])
  })

  test('小野真的改狀態也會取代提議', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    const proposal = await commitOperation(client, propose(target, 'missing'))
    await authorizeAgent(client, target.classId)
    const { receipts } = await agentSubmit(client, target.classId, [setStatus(target, 'on_time')])
    expect(receipts).toMatchObject([{ status: 'committed', changes: [
      { entity: 'submission' }, { entity: 'confirmation', key: { confirmation_id: proposal.op_id },
        value: { status: 'superseded' } },
    ] }])
  })

  test('作廢取代同作業所有提議，重複作廢與恢復不改項目', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client, { students: ['enrolled', 'enrolled'] }))
    const otherTask = await assignTask(client, target)
    const first = await commitOperation(client, propose(target, 'missing'))
    const second = await commitOperation(client, propose({ ...target, studentId: target.studentIds[1] }, 'late'))
    const other = await commitOperation(client, propose(otherTask, 'late'))
    const voided = await commitOperation(client, voidTask(target.classId, target.taskId, false))
    expect(voided.changes[0].entity).toBe('task')
    expect(voided.changes.slice(1)).toHaveLength(2)
    expect(voided.changes.slice(1)).toEqual(expect.arrayContaining([first, second].map(({ op_id }) =>
      expect.objectContaining({
        entity: 'confirmation', key: { confirmation_id: op_id }, rev: 2,
        value: { status: 'superseded', processed_at: voided.committed_at, processed_op_id: voided.op_id },
      }),
    )))
    const repeat = await commitOperation(client, voidTask(target.classId, target.taskId, true, 2))
    expect(repeat).toMatchObject({ result: { noop: true }, changes: [{ entity: 'task' }] })
    await commitOperation(client, restoreTask(target.classId, target.taskId))
    expect(await confirmationsFor(client, target.classId)).toMatchObject([
      { status: 'superseded', rev: 2 }, { status: 'superseded', rev: 2 },
      { confirmation_id: other.op_id, status: 'pending', rev: 1 },
    ])
  })
})
