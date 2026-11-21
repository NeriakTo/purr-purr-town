import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { confirm, confirmationsFor, propose, submissionData } from './test-support/confirmations.js'
import { addClass, operationCount, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, balanceOf, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function reject(classId, confirmationId) {
  return confirm(classId, confirmationId, 'confirmation.reject')
}

async function proposalFixture(client, status = 'missing') {
  const target = await assignTask(client, await addClass(client))
  const proposal = await commitOperation(client, propose(target, status))
  return { target, proposal }
}

async function changeFixtureStatus(client, target, status) {
  await client.query(`
    UPDATE ppt.submissions SET status = $4
    WHERE class_id = $1 AND task_id = $2 AND student_id = $3
  `, [target.classId, target.taskId, target.studentId, status])
}

describeDatabase('OP-16 與 OP-17 處理學生點收提議', () => {
  const database = useTestDatabase()

  test('確認缺交以 OP-16 一次推進版本、扣分並確認提議', async () => {
    const { client } = database()
    const { target, proposal } = await proposalFixture(client)
    const { classId } = target
    await saveEventRule(client, classId, 'submission.missing', -5)
    const beforeCount = await operationCount(client)
    const receipt = await commitOperation(client, confirm(classId, proposal.op_id))
    expect(await operationCount(client)).toBe(beforeCount + 1)
    expect(await submissionRow(client, target)).toMatchObject({
      status: 'missing', rev: 2, basis_rev: 2, last_op_id: receipt.op_id,
    })
    expect(receipt.result.effects_added).toMatchObject([{ event: 'submission.missing', amount: -5 }])
    expect(receipt.changes).toMatchObject([
      { entity: 'submission', prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 2 },
      { entity: 'account', value: { balance: -5 } },
      { entity: 'confirmation', key: { confirmation_id: proposal.op_id }, prev_rev: 1, rev: 2,
        value: { status: 'confirmed', processed_op_id: receipt.op_id, processed_at: receipt.committed_at } },
    ])
    expect(await confirmationsFor(client, classId)).toMatchObject([
      { status: 'confirmed', processed_op_id: receipt.op_id, processed_at: new Date(receipt.committed_at), rev: 2 },
    ])
    expect(await balanceOf(client, target)).toBe(-5)
    expect(await submit(client, confirm(classId, proposal.op_id))).toMatchObject({ code: 'CONFIRMATION_NOT_PENDING' })
  })

  test('確認準時在同一筆操作發每日任務獎勵', async () => {
    const { client } = database()
    const { target, proposal } = await proposalFixture(client, 'on_time')
    const second = await assignTask(client, target)
    await saveEventRule(client, target.classId, 'daily_quest.complete', 7)
    expect((await markSubmission(client, second, 'makeup')).result.transactions).toEqual([])
    const receipt = await commitOperation(client, confirm(target.classId, proposal.op_id))
    expect(receipt.result.effects_added).toMatchObject([
      { event: 'daily_quest.complete', subject_kind: 'date', subject_key: '2026-11-22', amount: 7 },
    ])
    const { rows } = await client.query('SELECT op_id FROM ppt.transactions WHERE transaction_id = $1',
      [receipt.result.transactions[0]])
    expect(rows).toEqual([{ op_id: receipt.op_id }])
    expect(await balanceOf(client, target)).toBe(7)
  })

  test('被取代與退回的項目不可確認，退回後可再提議且未改繳交或點數', async () => {
    const { client } = database()
    const { target, proposal } = await proposalFixture(client)
    const { classId } = target
    const second = await commitOperation(client, propose(target, 'late'))
    const before = await submissionData(client, classId)
    const rejected = await commitOperation(client, reject(classId, second.op_id))
    expect(rejected.changes).toMatchObject([{ entity: 'confirmation', rev: 2, value: { status: 'rejected' } }])
    expect(rejected.result.transactions).toEqual([])
    expect(await submissionData(client, classId)).toEqual(before)
    for (const id of [proposal.op_id, second.op_id]) {
      expect(await submit(client, confirm(classId, id))).toMatchObject({ code: 'CONFIRMATION_NOT_PENDING' })
      expect(await submit(client, reject(classId, id))).toMatchObject({ code: 'CONFIRMATION_NOT_PENDING' })
    }
    await commitOperation(client, propose(target, 'on_time'))
  })

  test('提議後學生轉出，確認被擋且仍能退回', async () => {
    const { client } = database()
    const { target, proposal } = await proposalFixture(client)
    await client.query("UPDATE ppt.students SET enrollment_status = 'transferred' WHERE class_id = $1 AND student_id = $2",
      [target.classId, target.studentId])
    expect(await submit(client, confirm(target.classId, proposal.op_id))).toMatchObject({ code: 'ENTITY_INACTIVE' })
    expect(await confirmationsFor(client, target.classId)).toMatchObject([{ status: 'pending', rev: 1 }])
    await commitOperation(client, reject(target.classId, proposal.op_id))
  })

  test.each([['on_time', 'INVALID_TRANSITION'], ['unknown', 'OK']])(
    '確認時繳交為 %s 回 %s', async (status, code) => {
      const { client } = database()
      const { target, proposal } = await proposalFixture(client)
      await changeFixtureStatus(client, target, status)
      const receipt = await submit(client, confirm(target.classId, proposal.op_id))
      expect(receipt.code).toBe(code)
      expect(await confirmationsFor(client, target.classId)).toMatchObject([
        { status: code === 'OK' ? 'confirmed' : 'pending' },
      ])
    },
  )

  test('整組三筆提議以三筆 OP-16 分別確認', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client, { students: ['enrolled', 'enrolled', 'enrolled'] }))
    const statuses = ['on_time', 'late', 'missing']
    const ids = []
    for (const [index, studentId] of target.studentIds.entries()) {
      const receipt = await commitOperation(client, propose({ ...target, studentId }, statuses[index]))
      ids.push(receipt.op_id)
    }
    for (const [index, id] of ids.entries()) {
      await commitOperation(client, confirm(target.classId, id))
      expect(await submissionRow(client, { ...target, studentId: target.studentIds[index] }))
        .toMatchObject({ status: statuses[index], rev: 2 })
    }
    expect((await confirmationsFor(client, target.classId)).map(({ status }) => status))
      .toEqual(['confirmed', 'confirmed', 'confirmed'])
  })

  test('兩種操作遇資料不完整的小野暫緩項目皆丟例外且整筆回復', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const heldId = 'd'.repeat(64)
    await client.query(`
      WITH held AS (
        INSERT INTO ppt.operations (op_id, class_id, actor_kind, actor_id, content_hash, status, recorded_at)
        VALUES ($1, $2, 'agent', 'agent-fixture', sha256(''::bytea), 'held', clock_timestamp()) RETURNING op_id
      )
      INSERT INTO ppt.confirmations (class_id, confirmation_id, kind, created_op_id, created_at, last_op_id)
      SELECT $2, $3, 'agent_held', op_id, clock_timestamp(), op_id FROM held
    `, [randomUUID(), classId, heldId])
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    for (const op of [confirm(classId, heldId), reject(classId, heldId)]) {
      await expect(submit(client, op)).rejects.toMatchObject({ code: expect.not.stringMatching(/^0A000$/) })
      expect(await classSnapshot(client, classId)).toBe(before)
      expect(await operationCount(client)).toBe(count)
    }
  })
})
