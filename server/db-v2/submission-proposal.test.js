import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { confirmationsFor, propose, submissionData } from './test-support/confirmations.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, voidTask } from './test-support/schoolwork.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function setNonparticipating(client, target) {
  await client.query(`
    UPDATE ppt.submissions SET assignment_active = false, basis_rev = 0
    WHERE class_id = $1 AND task_id = $2 AND student_id = $3
  `, [target.classId, target.taskId, target.studentId])
}

async function importTargets(client, classId) {
  const taskId = 'b'.repeat(64)
  const studentId = 'c'.repeat(64)
  await client.query(`
    INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester)
    VALUES ($1, $2, '匯入作業', '作業', '2026-01-01', '2026-01-02', '114-1')
  `, [classId, taskId])
  await client.query(`
    INSERT INTO ppt.students (class_id, student_id, seat_number, name)
    VALUES ($1, $2, 1, '1號村民')
  `, [classId, studentId])
  await client.query('INSERT INTO ppt.accounts (class_id, student_id) VALUES ($1, $2)', [classId, studentId])
  await client.query(`
    INSERT INTO ppt.submissions (class_id, task_id, student_id, status, legacy_status_at_import)
    VALUES ($1, $2, $3, 'unknown', 'unknown')
  `, [classId, taskId, studentId])
  return { classId, taskId, studentId }
}

describeDatabase('OP-15 學生點收提議', () => {
  const database = useTestDatabase()

  test('無小組的舊截止日提議只建立待確認項目，繳交與點數原樣', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await saveEventRule(client, classId, 'submission.missing', -5)
    await saveEventRule(client, classId, 'daily_quest.complete', 7)
    const target = await assignTask(client, { classId, studentId }, { due_on: '2020-03-05' })
    const before = await submissionData(client, classId)
    const op = propose(target, 'missing')
    const receipt = await commitOperation(client, op)
    expect(receipt.result).toEqual({ noop: false, transactions: [], effects_added: [], effects_reversed: [] })
    expect(receipt.changes).toEqual([{
      entity: 'confirmation', key: { confirmation_id: op.op_id }, prev_rev: 0, rev: 1,
      last_op_id: op.op_id, prev_value: null, value: {
        kind: 'leader_proposal', status: 'pending', task_id: target.taskId, student_id: studentId,
        proposed_status: 'missing', created_op_id: op.op_id, created_at: receipt.committed_at,
        processed_op_id: null, processed_at: null,
      },
    }])
    expect(await confirmationsFor(client, classId)).toMatchObject([{
      confirmation_id: op.op_id, kind: 'leader_proposal', status: 'pending', proposed_status: 'missing',
      created_op_id: op.op_id, created_at: new Date(receipt.committed_at), rev: 1, last_op_id: op.op_id,
    }])
    expect(await submissionData(client, classId)).toEqual(before)
  })

  test.each([
    ['無繳交', 'NOT_FOUND'], ['不參與', 'NOT_FOUND'], ['作廢', 'ENTITY_INACTIVE'],
    ['轉出', 'ENTITY_INACTIVE'], ['已點收', 'INVALID_TRANSITION'],
  ])('%s 的提議回 %s', async (condition, code) => {
    const { client } = database()
    const target = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const fields = condition === '無繳交' ? { assignee_ids: [target.studentIds[1]] } : {}
    const assigned = await assignTask(client, target, fields)
    if (condition === '不參與') await setNonparticipating(client, assigned)
    if (condition === '作廢') await commitOperation(client, voidTask(target.classId, assigned.taskId, false))
    if (condition === '轉出') {
      await client.query("UPDATE ppt.students SET enrollment_status = 'transferred' WHERE class_id = $1 AND student_id = $2",
        [target.classId, target.studentId])
    }
    if (condition === '已點收') await markSubmission(client, assigned, 'on_time')
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, propose(assigned, 'late'))).toMatchObject({ code })
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  test('重提取代舊項目，直接插入第二筆待確認受唯一索引限制', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    const first = await commitOperation(client, propose(target, 'late'))
    const second = await commitOperation(client, propose(target, 'on_time'))
    expect(second.changes).toMatchObject([
      { key: { confirmation_id: first.op_id }, prev_rev: 1, rev: 2, last_op_id: second.op_id,
        prev_value: { status: 'pending', processed_at: null, processed_op_id: null },
        value: { status: 'superseded', processed_at: second.committed_at, processed_op_id: second.op_id } },
      { key: { confirmation_id: second.op_id }, rev: 1, value: { status: 'pending' } },
    ])
    expect(await confirmationsFor(client, target.classId)).toMatchObject([
      { confirmation_id: first.op_id, status: 'superseded' }, { confirmation_id: second.op_id, status: 'pending' },
    ])
    const duplicateId = randomUUID()
    await expect(client.query(`
      WITH claim AS (
        INSERT INTO ppt.operations (op_id, class_id, actor_kind, actor_id, content_hash, status, recorded_at)
        VALUES ($1, $2, 'teacher', 'teacher-fixture', sha256(''::bytea), 'held', clock_timestamp())
        RETURNING op_id
      )
      INSERT INTO ppt.confirmations (
        class_id, confirmation_id, kind, task_id, student_id, proposed_status, created_op_id, created_at, last_op_id
      )
      SELECT $2, op_id, 'leader_proposal', $3, $4, 'on_time', op_id, clock_timestamp(), op_id FROM claim
    `, [duplicateId, target.classId, target.taskId, target.studentId])).rejects.toMatchObject({
      code: '23505', constraint: 'confirmations_pending_leader_proposal',
    })
  })

  test('既有匯入作業與學生可用 64 字元編號提議，unknown 視同待收', async () => {
    const { client } = database()
    const { classId } = await addClass(client, { students: [] })
    const target = await importTargets(client, classId)
    const receipt = await commitOperation(client, propose(target, 'on_time'))
    expect(receipt.changes).toMatchObject([{
      entity: 'confirmation', value: { task_id: target.taskId, student_id: target.studentId, proposed_status: 'on_time' },
    }])
  })

  test('小野不能提議，老師的提議禁帶版本條件', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    await authorizeAgent(client, target.classId)
    const { receipts } = await agentSubmit(client, target.classId, [propose(target, 'late')])
    expect(receipts).toMatchObject([{ code: 'FORBIDDEN_ROLE' }])
    expect(await submit(client, { ...propose(target, 'late'), expect: { rev: 1 } })).toMatchObject({
      code: 'INVALID_PAYLOAD',
    })
  })
})
