import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { submit, teacher } from './test-support/operations.js'
import { commitOperation, saveRule, voidTask } from './test-support/schoolwork.js'
import { markSubmission } from './test-support/submission-flow.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'
import {
  effectRow, expectSubmissionState, lateEvent, missingEvent, setupSubmissionUndo,
} from './test-support/undo-submissions.js'

async function setEnrollment(client, target, status) {
  await client.query('UPDATE ppt.students SET enrollment_status = $2 WHERE class_id = $1', [target.classId, status])
}

async function expectRestoredLateEffect(client, target, original, snapshot, undone) {
  expect(undone.result.effects_added).toHaveLength(1)
  const [added] = undone.result.effects_added
  const restored = await transactionFrom(client, undone, 1)
  expect(undone.result.transactions).toHaveLength(2)
  expect(restored).toMatchObject({
    kind: 'rule_auto', amount: String(snapshot.effective_amount), earned_delta: String(snapshot.effective_amount),
    rule_id: snapshot.rule_id, rule_rev: snapshot.rule_rev, effective_at: original.effective_at,
    semester: original.semester, occurred_at: new Date(undone.committed_at),
    restored_from_transaction_id: original.transaction_id, reason: original.reason,
  })
  expect(added).toMatchObject({
    event: lateEvent, lineage_id: snapshot.lineage_id, amount: -10, root_transaction_id: restored.transaction_id,
  })
  const { rows } = await client.query(`
    SELECT effect_id, origin, created_op_id, status FROM ppt.effects
    WHERE class_id = $1 AND lineage_id = $2 AND status = 'active'
  `, [target.classId, snapshot.lineage_id])
  expect(rows).toEqual([{ effect_id: added.effect_id, origin: 'op', created_op_id: undone.op_id, status: 'active' }])
}

describeDatabase('繳交撤銷 OP-14', () => {
  const database = useTestDatabase()

  test('撤銷缺交回待收並沖回扣分，收據列新舊版本與基準', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const marked = await markSubmission(client, target, 'missing')
    const [added] = marked.result.effects_added
    const undone = await commitOperation(client, undo(target.classId, marked.op_id))
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
    expect(await effectRow(client, target.classId, added.effect_id)).toMatchObject({
      status: 'reversed', reversed_op_id: undone.op_id,
    })
    expect(undone.changes).toEqual([
      {
        entity: 'submission', key: { task_id: target.taskId, student_id: target.studentId },
        prev_rev: 2, rev: 3, prev_basis_rev: 2, basis_rev: 1, last_op_id: undone.op_id,
        prev_value: { status: 'missing', assignment_active: true },
        value: { status: 'pending', assignment_active: true },
      },
      expect.objectContaining({ entity: 'account' }),
    ])
    expect(undone.result).toMatchObject({
      transactions: [expect.any(String)],
      effects_reversed: [expect.objectContaining({ effect_id: added.effect_id, effective_amount: -20 })],
      effects_added: [],
      undo: { target_op_id: marked.op_id, skipped: [], amount_changed: [] },
    })
  })

  test.each([
    ['原規則', false],
    ['規則改版', true],
  ])('依快照補回遲交扣分與版本（%s）', async (_label, changeRule) => {
    const { client } = database()
    const { target, lateRule } = await setupSubmissionUndo(client)
    const late = await markSubmission(client, target, 'late')
    const original = await transactionFrom(client, late)
    const missing = await markSubmission(client, target, 'missing', 2)
    if (changeRule) await commitOperation(client, saveRule(target.classId, { ...lateRule, amount: -77 }, 1))
    const undone = await commitOperation(client, undo(target.classId, missing.op_id))
    await expectSubmissionState(client, target, 4, 2, 'late', -10, [[lateEvent, -10]])
    expect(undone.result.effects_reversed).toMatchObject([
      { effect_id: missing.result.effects_added[0].effect_id, effective_amount: -20 },
    ])
    expect(await transactionFrom(client, undone)).toMatchObject({ kind: 'reversal', amount: '20' })
    expect(undone.warnings).toEqual([])
    await expectRestoredLateEffect(client, target, original, missing.result.effects_reversed[0], undone)
  })

  test('撤銷補交只回復繳交列，保留既有扣分', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    const makeup = await markSubmission(client, target, 'makeup', 2)
    const undone = await commitOperation(client, undo(target.classId, makeup.op_id))
    await expectSubmissionState(client, target, 4, 2, 'missing', -20, [[missingEvent, -20]])
    expect(undone.changes.map(({ entity }) => entity)).toEqual(['submission'])
    expect(undone.result).toMatchObject({
      noop: false, transactions: [], effects_added: [], effects_reversed: [],
    })
    expect(await effectRow(client, target.classId, missing.result.effects_added[0].effect_id))
      .toMatchObject({ status: 'active', reversed_op_id: null })
  })

  test('原點收沒有改資料時，作業已作廢仍成立且不改資料', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    await markSubmission(client, target, 'on_time')
    const noop = await markSubmission(client, target, 'on_time', 2)
    await commitOperation(client, voidTask(target.classId, target.taskId, false))
    const before = await classSnapshot(client, target.classId, { ignoreClassSequence: true })
    const undone = await commitOperation(client, undo(target.classId, noop.op_id))
    await expectSubmissionState(client, target, 2, 2, 'on_time', 0)
    expect(undone.result).toEqual({
      noop: true, transactions: [], effects_added: [], effects_reversed: [],
      undo: { target_op_id: noop.op_id, skipped: [], amount_changed: [] },
    })
    expect(undone.changes).toEqual([])
    expect(undone.warnings).toEqual([])
    expect(await classSnapshot(client, target.classId, { ignoreClassSequence: true })).toBe(before)
  })

  test.each(['作業作廢', '學生轉出'])('%s時撤銷被拒且資料不變', async (condition) => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    if (condition === '作業作廢') {
      await commitOperation(client, voidTask(target.classId, target.taskId, false))
    } else {
      await setEnrollment(client, target, 'transferred')
    }
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, undo(target.classId, missing.op_id)))
      .toMatchObject({ status: 'rejected', code: 'ENTITY_INACTIVE' })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    await expectSubmissionState(client, target, 2, 2, 'missing', -20, [[missingEvent, -20]])
    if (condition === '學生轉出') {
      await setEnrollment(client, target, 'enrolled')
      await commitOperation(client, undo(target.classId, missing.op_id))
      await expectSubmissionState(client, target, 3, 1, 'pending', 0)
    }
  })

  test('基準不符回 UNDO_CONFLICT，提供目前繳交版本且資料不變', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    const latest = await markSubmission(client, target, 'on_time', 2)
    const before = await classSnapshot(client, target.classId)
    const rejected = await submit(client, undo(target.classId, missing.op_id))
    expect(rejected).toMatchObject({ status: 'rejected', code: 'UNDO_CONFLICT' })
    expect(rejected.current).toEqual({
      reason: 'basis_changed', rev: 3, basis_rev: 3, value: { status: 'on_time', assignment_active: true },
      last_op_id: latest.op_id, actor: teacher, committed_at: latest.committed_at,
    })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    await expectSubmissionState(client, target, 3, 3, 'on_time', 0)
  })

  test.each([
    ['已單獨沖回', 'already_reversed', null, 'skipped'],
    ['已更正金額', 'amount_changed', -8, 'amount_changed'],
  ])('缺交效果%s時照撤並附提示', async (_label, reason, amount, resultKey) => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const missing = await markSubmission(client, target, 'missing')
    const [effect] = missing.result.effects_added
    const rootId = effect.root_transaction_id
    const changed = await commitOperation(client, amount === null
      ? reverse(target.classId, rootId, -20)
      : correct(target.classId, rootId, -20, amount))
    const undone = await commitOperation(client, undo(target.classId, missing.op_id))
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
    const detail = {
      effect_id: effect.effect_id, lineage_id: effect.lineage_id, transaction_id: rootId,
      changed_by_op_id: changed.op_id, original_amount: -20, amount,
    }
    expect(undone.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: reason, ...detail }])
    expect(undone.result.undo[resultKey]).toEqual([detail])
    expect(undone.result.noop).toBe(false)
    if (amount === null) {
      expect(undone.result.transactions).toEqual([])
      expect(undone.result.effects_reversed).toEqual([])
    } else {
      expect(await transactionFrom(client, undone)).toMatchObject({ kind: 'reversal', amount: '8' })
      expect(undone.result.effects_reversed).toMatchObject([{ effect_id: effect.effect_id, effective_amount: -8 }])
    }
  })

  test('沖回快照金額為零時略過補回，也沒有提醒', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const late = await markSubmission(client, target, 'late')
    await commitOperation(client, correct(target.classId, late.result.transactions[0], -10, 0))
    const missing = await markSubmission(client, target, 'missing', 2)
    expect(missing.result.effects_reversed[0].effective_amount).toBe(0)
    const undone = await commitOperation(client, undo(target.classId, missing.op_id))
    await expectSubmissionState(client, target, 4, 2, 'late', 0)
    expect(undone.result.effects_added).toEqual([])
    expect(undone.result.transactions).toHaveLength(1)
    expect(undone.warnings).toEqual([])
  })

  test('OP-14 可以用 after_op 接在撤銷的繳交版本之後', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    const marked = await markSubmission(client, target, 'missing')
    const undone = await commitOperation(client, undo(target.classId, marked.op_id))
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)
    await commitOperation(client, setStatus(target, 'late', { after_op: undone.op_id }))
    await expectSubmissionState(client, target, 4, 4, 'late', -10, [[lateEvent, -10]])
  })

  test('小野與老師都可撤小野的 OP-14，回小野的衝突收據只留操作者種類', async () => {
    const { client } = database()
    const { target } = await setupSubmissionUndo(client)
    await authorizeAgent(client, target.classId)
    const first = setStatus(target, 'missing')
    expect((await agentSubmit(client, target.classId, [first])).receipts[0].code).toBe('OK')
    expect((await agentSubmit(client, target.classId, [undo(target.classId, first.op_id)])).receipts[0].code).toBe('OK')
    await expectSubmissionState(client, target, 3, 1, 'pending', 0)

    const second = setStatus(target, 'late', { rev: 3 })
    expect((await agentSubmit(client, target.classId, [second])).receipts[0].code).toBe('OK')
    const teacherMark = await markSubmission(client, target, 'on_time', 4)
    const { receipts: [conflict] } = await agentSubmit(client, target.classId, [undo(target.classId, second.op_id)])
    expect(conflict).toMatchObject({ code: 'UNDO_CONFLICT', current: { reason: 'basis_changed' } })
    expect(conflict.current.actor).toEqual({ kind: 'teacher' })
    await expectSubmissionState(client, target, 5, 5, 'on_time', 0)
    await commitOperation(client, undo(target.classId, teacherMark.op_id))
    await commitOperation(client, undo(target.classId, second.op_id))
    await expectSubmissionState(client, target, 7, 1, 'pending', 0)
  })
})
