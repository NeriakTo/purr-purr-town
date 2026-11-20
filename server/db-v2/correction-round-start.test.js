import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  authorizeCorrectionAgent, changeRound, correctionRow, createRound, requireRound, returnRound,
  setEnrollment, setupCorrectionTask, submitAgentCorrection, taipeiDayOffset,
} from './test-support/correction-rounds.js'
import { addClass, teacher } from './test-support/operations.js'
import { commitOperation, voidTask } from './test-support/schoolwork.js'
import { assignTask, balanceOf } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'

async function insertDuplicateRound(client, target, round, status) {
  return client.query(`
    INSERT INTO ppt.corrections (class_id, correction_id, task_id, student_id, round, status)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [target.classId, randomUUID(), target.taskId, target.studentId, round, status])
}

describeDatabase('訂正建立與交回', () => {
  const database = useTestDatabase()

  test('部分唯一索引擋下第二輪未結束的訂正', async () => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    await expect(insertDuplicateRound(client, target, 2, 'returned')).rejects.toMatchObject({
      code: '23505', constraint: 'corrections_one_open_round',
    })
  })

  test('唯一限制擋下重複輪次', async () => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    await expect(insertDuplicateRound(client, target, 1, 'cancelled')).rejects.toMatchObject({
      code: '23505', constraint: 'corrections_unique_round',
    })
  })

  test('OP-18 建第一輪並回完整收據，餘額不變', async () => {
    const { client } = database()
    const dueOn = await taipeiDayOffset(client, -10)
    const target = await createRound(client, await setupCorrectionTask(client), { due_on: dueOn, note: '檢查算式' })
    const { created } = target
    const value = {
      task_id: target.taskId, student_id: target.studentId, round: 1,
      status: 'required', due_on: dueOn, note: '檢查算式', overdue_on: null,
    }
    expect(await correctionRow(client, target)).toEqual({
      ...value, class_id: target.classId, correction_id: target.correctionId,
      rev: 1, basis_rev: 1, last_op_id: created.op_id,
    })
    expect(created.changes).toEqual([{
      entity: 'correction', key: { correction_id: target.correctionId }, prev_rev: 0, rev: 1,
      prev_basis_rev: 0, basis_rev: 1, last_op_id: created.op_id, prev_value: null, value,
    }])
    expect(created.result.transactions).toEqual([])
    expect(await balanceOf(client, target)).toBe(0)
  })

  test.each([
    ['省略', {}], ['JSON null', { due_on: null, note: null }], ['純空白', { note: ' \t\n ' }],
  ])('OP-18 的選填輸入（%s）存成空值', async (_name, fields) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client), fields)
    expect(await correctionRow(client, target)).toMatchObject({ due_on: null, note: null })
  })

  test('沒有繳交也可建立訂正', async () => {
    const { client } = database()
    const group = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const target = await assignTask(client, group, { assignee_ids: [group.studentIds[1]] })
    const { rowCount } = await client.query(
      'SELECT 1 FROM ppt.submissions WHERE class_id = $1 AND task_id = $2 AND student_id = $3',
      [target.classId, target.taskId, target.studentId],
    )
    expect(rowCount).toBe(0)
    expect((await createRound(client, target)).created.code).toBe('OK')
  })

  test('有未結束輪次時拒絕第二輪並保留整班快照', async () => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    await rejectUndoWithoutChanges(client, requireRound(target), 'INVALID_TRANSITION')
  })

  test('訂正編號只在本班衝突', async () => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client, { students: ['enrolled', 'enrolled'] }))
    const fields = { correction_id: target.correctionId }
    const otherStudent = { ...target, studentId: target.studentIds[1] }
    await rejectUndoWithoutChanges(client, requireRound(otherStudent, fields), 'ID_CONFLICT')
    expect((await createRound(client, await setupCorrectionTask(client), fields)).created.code).toBe('OK')
  })

  test.each(['task_id', 'student_id'])('OP-18 查不到 %s 回 NOT_FOUND', async (key) => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    const receipt = await rejectUndoWithoutChanges(client, requireRound(target, { [key]: randomUUID() }), 'NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  })

  test.each([
    ['作業作廢', (client, target) => commitOperation(client, voidTask(target.classId, target.taskId, false))],
    ['學生轉出', (client, target) => setEnrollment(client, target, 'transferred')],
  ])('OP-18 在%s時回 ENTITY_INACTIVE', async (_name, deactivate) => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    await deactivate(client, target)
    await rejectUndoWithoutChanges(client, requireRound(target), 'ENTITY_INACTIVE')
  })

  test.each([
    ['缺 correction_id', (op) => { delete op.payload.correction_id }],
    ['64 字元編號', (op) => { op.payload.correction_id = 'a'.repeat(64) }],
    ['無效日期', (op) => { op.payload.due_on = '2026-02-30' }],
    ['備註超長', (op) => { op.payload.note = '字'.repeat(101) }],
    ['多餘的鍵', (op) => { op.payload.extra = true }],
    ['expect 物件', (op) => { op.expect = { rev: 0 } }],
    ['expect null', (op) => { op.expect = null }],
  ])('OP-18 拒絕 %s', async (_name, mutate) => {
    const { client } = database()
    const op = requireRound(await setupCorrectionTask(client))
    mutate(op)
    await rejectUndoWithoutChanges(client, op, 'INVALID_PAYLOAD')
  })

  test.each([
    ['rev', () => ({ rev: 1 })], ['after_op', ({ created }) => ({ after_op: created.op_id })],
  ])('OP-19 用 %s 交回並只回狀態變更', async (_name, version) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client), { note: '檢查算式' })
    const receipt = await commitOperation(client, changeRound(target, 'mark_returned', version(target)))
    expect(receipt.changes).toEqual([{
      entity: 'correction', key: { correction_id: target.correctionId }, prev_rev: 1, rev: 2,
      prev_basis_rev: 1, basis_rev: 2, last_op_id: receipt.op_id,
      prev_value: { status: 'required' }, value: { status: 'returned' },
    }])
    expect(await correctionRow(client, target)).toMatchObject({ status: 'returned', rev: 2, basis_rev: 2 })
  })

  test.each([2, 1])('重複交回（rev %s）優先回 INVALID_TRANSITION', async (rev) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    await returnRound(client, target)
    await rejectUndoWithoutChanges(client, changeRound(target, 'mark_returned', { rev }), 'INVALID_TRANSITION')
  })

  test.each([5, 0])('OP-19 的版本 %s 不符時回四鍵現況', async (rev) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client), { note: '檢查算式' })
    const receipt = await rejectUndoWithoutChanges(client, changeRound(target, 'mark_returned', { rev }), 'STALE_STATE')
    expect(receipt.current).toEqual({
      value: { status: 'required', round: 1, due_on: null, overdue_on: null },
      rev: 1, last_op_id: target.created.op_id, actor: teacher, committed_at: target.created.committed_at,
    })
  })

  test.each([undefined, null])('OP-19 拒絕 expect 為 %s', async (version) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    await rejectUndoWithoutChanges(client, changeRound(target, 'mark_returned', version), 'INVALID_PAYLOAD')
  })

  test('小野可建立與交回，操作紀錄保存小野身分', async () => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    await authorizeCorrectionAgent(client, target)
    const create = requireRound(target, { note: '檢查算式' })
    const first = await submitAgentCorrection(client, create)
    expect(first).toMatchObject({ code: 'OK', changes: [{ value: { note: '檢查算式' } }] })
    const correction = { ...target, correctionId: create.payload.correction_id }
    const returned = changeRound(correction, 'mark_returned', { after_op: first.op_id })
    expect(await submitAgentCorrection(client, returned)).toMatchObject({ code: 'OK' })
    const { rows } = await client.query(
      'SELECT actor_kind, actor_id FROM ppt.operations WHERE op_id = ANY($1) ORDER BY class_seq',
      [[create.op_id, returned.op_id]],
    )
    expect(rows).toEqual(Array.from({ length: 2 }, () => ({ actor_kind: 'agent', actor_id: 'agent' })))
  })

  test('小野查不到作業與訂正一律回 SCOPE_FORBIDDEN', async () => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    await authorizeCorrectionAgent(client, target)
    const wrongTask = requireRound(target, { task_id: randomUUID() })
    const wrongRound = changeRound({ ...target, correctionId: randomUUID() }, 'mark_returned', { rev: 1 })
    for (const op of [wrongTask, wrongRound]) {
      const receipt = await submitAgentCorrection(client, op)
      expect(receipt).toMatchObject({ code: 'SCOPE_FORBIDDEN' })
      expect(receipt).not.toHaveProperty('current')
    }
  })

  test('小野版本不符時只看到老師的身分類型與四鍵現況', async () => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client), { note: '檢查算式' })
    await authorizeCorrectionAgent(client, target)
    const receipt = await submitAgentCorrection(client, changeRound(target, 'mark_returned', { rev: 5 }))
    expect(receipt).toMatchObject({ code: 'STALE_STATE' })
    expect(receipt.current.actor).toEqual({ kind: 'teacher' })
    expect(receipt.current.value).toEqual({ status: 'required', round: 1, due_on: null, overdue_on: null })
  })
})
