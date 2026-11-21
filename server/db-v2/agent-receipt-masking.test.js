import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { authorizeAgent } from './test-support/agent.js'
import { confirm, propose } from './test-support/confirmations.js'
import { changeRound, requireRound } from './test-support/correction-rounds.js'
import { addImportedDeduction, addImportedEffect } from './test-support/legacy-effects.js'
import { addClass, submit } from './test-support/operations.js'
import { agentSubmitAs, connectAsRole } from './test-support/roles.js'
import { createTask, saveRule } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { undo } from './test-support/undo.js'

const teacher = { kind: 'teacher', id: '老師編號記號甲' }
const teacherNote = '老師備註記號甲'

async function submitTeacher(web, op) {
  const receipt = await submit(web, op, teacher)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

async function submissionFixture(db, { studentCount = 1, missingPenalty = false } = {}) {
  const [agent, web] = await Promise.all([connectAsRole(db, 'ppt_agent'), connectAsRole(db, 'ppt_web')])
  const { client } = db
  const fixture = await addClass(client, { owner: teacher, students: Array(studentCount).fill('enrolled') })
  const { classId } = fixture
  await authorizeAgent(client, classId)
  const task = createTask(classId)
  await submitTeacher(web, task)
  if (missingPenalty) {
    await submitTeacher(web, saveRule(classId, { kind: 'event', event: 'submission.missing', amount: -5 }))
  }
  const taskId = task.payload.task_id
  const target = { ...fixture, taskId }
  const send = (ops, callId) => agentSubmitAs(agent, classId, ops, callId)
  return { web, client, target, classId, send }
}

function expectNoTeacherData(value) {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain(teacher.id)
  expect(serialized).not.toContain(teacherNote)
}

function expectMaskedConflict(receipt, { code, lastOpId, current = {} }) {
  expect(receipt).toMatchObject({
    status: 'rejected', code, current: { ...current, last_op_id: lastOpId },
  })
  expect(receipt.current.actor).toEqual({ kind: 'teacher' })
}

async function expectStoredReceipts(client, classId, batch) {
  const { rows } = await client.query(`
    SELECT op_id, receipt FROM ppt.operations
    WHERE class_id = $1 AND actor_kind = 'agent' AND batch_id = $2
  `, [classId, batch.call_id])
  expect(rows).toHaveLength(batch.receipts.length)
  expectNoTeacherData(batch)
  expectNoTeacherData(rows)
  const byId = new Map(rows.map(row => [row.op_id, row.receipt]))
  for (const receipt of batch.receipts) {
    expect(byId.get(receipt.op_id)).toEqual({ ...receipt, replayed: false })
  }
}

async function commitAgentOperation(fixture, op) {
  const batch = await fixture.send([op])
  expect(batch.receipts).toMatchObject([{ op_id: op.op_id, status: 'committed', code: 'OK' }])
  await expectStoredReceipts(fixture.client, fixture.classId, batch)
  return batch.receipts[0]
}

async function expectAgentConflict(fixture, op, conflict) {
  const batch = await fixture.send([op])
  expect(batch.receipts).toHaveLength(1)
  expect(batch.receipts[0].op_id).toBe(op.op_id)
  expectMaskedConflict(batch.receipts[0], conflict)
  await expectStoredReceipts(fixture.client, fixture.classId, batch)
}

async function addActiveLateEffect(client, target) {
  const root = await addImportedDeduction(client, target, { reason: teacherNote })
  return addImportedEffect(client, target, { root, event: 'submission.late', status: 'active' })
}

describeDatabase('小野收據遮法', () => {
  const db = useTestDatabase()

  test('OP-14 版本不符時遮掉老師編號並保留最後操作編號', async () => {
    const fixture = await submissionFixture(db())
    const { web, target } = fixture
    const latest = await submitTeacher(web, setStatus(target, 'on_time'))
    await expectAgentConflict(fixture, setStatus(target, 'missing'), {
      code: 'STALE_STATE', lastOpId: latest.op_id, current: { rev: 2 },
    })
  })

  test('OP-14 提議擋下時遮掉老師編號並保留提議', async () => {
    const fixture = await submissionFixture(db())
    const { web, client, target } = fixture
    const { last_op_id: lastOpId } = await submissionRow(client, target)
    const proposal = await submitTeacher(web, propose(target, 'late'))
    const op = setStatus(target, 'missing')
    op.payload.only_if_no_proposal = true
    await expectAgentConflict(fixture, op, {
      code: 'STALE_STATE', lastOpId,
      current: { rev: 1, proposal: { confirmation_id: proposal.op_id, status: 'pending' } },
    })
  })

  test('OP-19 版本不符時保留既有遮法與最後操作編號', async () => {
    const fixture = await submissionFixture(db())
    const { web, target } = fixture
    const latest = await submitTeacher(web, requireRound(target, { note: teacherNote }))
    const round = { ...target, correctionId: latest.changes[0].key.correction_id }
    await expectAgentConflict(fixture, changeRound(round, 'mark_returned', { rev: 2 }), {
      code: 'STALE_STATE', lastOpId: latest.op_id, current: { rev: 1 },
    })
  })

  test('OP-50 遇到老師改過繳交基準時保留既有遮法', async () => {
    const fixture = await submissionFixture(db())
    const { web, target, classId } = fixture
    const original = await commitAgentOperation(fixture, setStatus(target, 'missing'))
    const latest = await submitTeacher(web, setStatus(target, 'on_time', { rev: 2 }))
    await expectAgentConflict(fixture, undo(classId, original.op_id), {
      code: 'UNDO_CONFLICT', lastOpId: latest.op_id, current: { reason: 'basis_changed', basis_rev: 3 },
    })
  })

  test('OP-50 遇到另一輪未結束的訂正時保留既有遮法', async () => {
    const fixture = await submissionFixture(db())
    const { web, client, target, classId } = fixture
    const first = await submitTeacher(web, requireRound(target))
    const round = { ...target, correctionId: first.changes[0].key.correction_id }
    const original = await submitTeacher(web, changeRound(round, 'confirm', { rev: 1 }))
    const latest = await submitTeacher(web, requireRound(target, { note: teacherNote }))
    const denied = await fixture.send([undo(classId, original.op_id)])
    expect(denied.receipts).toMatchObject([{ status: 'rejected', code: 'SCOPE_FORBIDDEN' }])
    expect(denied.receipts[0]).not.toHaveProperty('current')
    await expectStoredReceipts(client, classId, denied)

    // 小野無法建立 OP-20。只在測試庫造一筆歷史操作，讓撤銷通過自己的操作這道檢查。
    const { rowCount } = await client.query(`
      UPDATE ppt.operations SET actor_kind = 'agent', actor_id = 'agent' WHERE op_id = $1
    `, [original.op_id])
    expect(rowCount).toBe(1)
    await expectAgentConflict(fixture, undo(classId, original.op_id), {
      code: 'UNDO_CONFLICT', lastOpId: latest.op_id,
      current: { reason: 'open_round_exists', correction_id: latest.changes[0].key.correction_id },
    })
  })

  test('OP-50 遇到已生效的扣分時保留既有遮法', async () => {
    const fixture = await submissionFixture(db())
    const { web, client, target, classId } = fixture
    await submitTeacher(web, setStatus(target, 'late'))
    await addActiveLateEffect(client, target)
    const original = await commitAgentOperation(fixture, setStatus(target, 'missing', { rev: 2 }))
    const intervening = await submitTeacher(web, setStatus(target, 'on_time', { rev: 3 }))
    const latest = await submitTeacher(web, undo(classId, intervening.op_id))
    const effectId = await addActiveLateEffect(client, target)
    await expectAgentConflict(fixture, undo(classId, original.op_id), {
      code: 'UNDO_CONFLICT', lastOpId: latest.op_id,
      current: { reason: 'effect_already_active', effect_id: effectId, basis_rev: 3 },
    })
  })

  test('老師確認暫緩後小野以同一呼叫重送取得遮過的衝突收據', async () => {
    const fixture = await submissionFixture(db(), { studentCount: 6, missingPenalty: true })
    const { web, client, target, classId, send } = fixture
    const ops = target.studentIds.map(studentId => setStatus({ ...target, studentId }, 'missing'))
    const callId = randomUUID()
    const held = await send(ops, callId)
    expect(held.receipts).toMatchObject(ops.map(({ op_id }) => ({
      op_id, status: 'held', code: 'HELD_FOR_TEACHER',
    })))
    await expectStoredReceipts(client, classId, held)
    const latest = await submitTeacher(web, setStatus(target, 'on_time'))
    const approved = await submitTeacher(web, confirm(classId, ops[0].op_id))
    expect(approved.result.held.items).toEqual(ops.map(({ op_id }, index) => index === 0
      ? { op_id, status: 'rejected', code: 'STALE_STATE' }
      : { op_id, status: 'committed', code: 'OK' }))
    const replay = await send(ops, callId)
    expect(replay.call_id).toBe(callId)
    expect(replay.receipts).toMatchObject(ops.map(({ op_id }) => ({ op_id, replayed: true })))
    expectMaskedConflict(replay.receipts[0], { code: 'STALE_STATE', lastOpId: latest.op_id, current: { rev: 2 } })
    await expectStoredReceipts(client, classId, replay)
  })

  test('網站老師的 OP-14 版本衝突保留完整老師身分', async () => {
    const { web, target } = await submissionFixture(db())
    const latest = await submitTeacher(web, setStatus(target, 'on_time'))
    const receipt = await submit(web, setStatus(target, 'missing'), teacher)
    expect(receipt).toMatchObject({
      status: 'rejected', code: 'STALE_STATE', current: { rev: 2, last_op_id: latest.op_id },
    })
    expect(receipt.current.actor).toEqual(teacher)
  })

  test('遮法處理任意深度的物件與陣列並保留操作編號', async () => {
    const client = await connectAsRole(db(), 'ppt_owner')
    const original = {
      actor: teacher,
      changes: [{ value: [{ actor: { ...teacher, extra: true }, last_op_id: '操作編號記號甲' }] }],
      result: { nested: { actor: null, prior_op_id: '操作編號記號乙', id: '其他編號記號甲' } },
      current: { actor: { kind: 'agent', id: '小野編號記號甲' } },
      warnings: [],
    }
    const { rows: [{ receipt }] } = await client.query(
      'SELECT ppt.mask_receipt_actor_ids($1::jsonb) AS receipt', [original],
    )
    expect(receipt).toEqual({
      ...original,
      actor: { kind: 'teacher' },
      changes: [{ value: [{ actor: { kind: 'teacher' }, last_op_id: '操作編號記號甲' }] }],
      current: { actor: { kind: 'agent' } },
    })
  })
})
