import { expect, test } from 'vitest'
import { agentSubmit } from './test-support/agent.js'
import {
  addAgentClass, addAgentTask, addManualRule, agentApplyRule, agentCallRow, setAgentLimits,
} from './test-support/agent-fixtures.js'
import { heldMemberRows, holdAgentBatch, holdMissingSubmissions } from './test-support/agent-held.js'
import { classSnapshot } from './test-support/checks.js'
import { confirmationsFor, submissionData } from './test-support/confirmations.js'
import { classSequence, operationCount, submit } from './test-support/operations.js'
import { commitOperation, saveRule } from './test-support/schoolwork.js'
import { balanceOf, markSubmission } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

function resultItem(op_id, code = 'OK') {
  return { op_id, code, status: code === 'OK' ? 'committed' : 'rejected' }
}

function expectBatchOutcome(outer, callId, items, status) {
  expect(outer.result).toEqual({
    noop: false, transactions: [], effects_added: [], effects_reversed: [],
    held: { batch_id: callId, items },
  })
  expect(outer.changes).toMatchObject([{
    entity: 'confirmation', rev: 2,
    value: { status, processed_op_id: outer.op_id, processed_at: outer.committed_at },
  }])
  expect(outer.warnings).toEqual([])
}

async function expectFinalReplay(client, classId, callId, ops, rows) {
  expect(await agentSubmit(client, classId, ops, callId)).toEqual({
    call_id: callId, receipts: rows.map(({ receipt }) => ({ ...receipt, replayed: true })),
  })
}

describeDatabase('OP-16 與 OP-17 處理小野暫緩批次', () => {
  const db = useTestDatabase()

  test('確認六筆缺交保留小野身分，依原順序扣分，老師的序號最後', async () => {
    const { client } = db()
    const { classId, targets, ops, batch, approve } = await holdMissingSubmissions(client)
    const seq = await classSequence(client, classId)
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, ops.map(op => resultItem(op.op_id)), 'confirmed')
    expect(outer.class_seq).toBe(seq + 7)
    expect(await heldMemberRows(client, ops)).toEqual(ops.map((op, index) => expect.objectContaining({
      ...resultItem(op.op_id), class_seq: seq + index + 1, actor_kind: 'agent', actor_id: 'agent',
      batch_id: batch.call_id, committed_at: outer.committed_at,
      receipt: expect.objectContaining({
        committed_at: outer.committed_at,
        result: expect.objectContaining({ transactions: [expect.any(String)] }),
      }),
    })))
    for (const target of targets) {
      expect(await balanceOf(client, target)).toBe(-5)
      expect(await submissionRow(client, target)).toMatchObject({ status: 'missing', rev: 2 })
    }
    expect(await confirmationsFor(client, classId)).toMatchObject([
      { status: 'confirmed', processed_op_id: outer.op_id, processed_at: new Date(outer.committed_at) },
    ])
  })

  test('03:390 確認時分別擋下過期規則、轉出學生與已套用的規則', async () => {
    const { client } = db()
    const { classId, studentIds } = await addAgentClass(client, 6)
    const ruleA = await addManualRule(client, classId)
    const ruleB = await addManualRule(client, classId)
    const ops = studentIds.map((studentId, index) =>
      agentApplyRule({ classId, studentId }, index === 0 ? ruleA : ruleB))
    const { batch, approve } = await holdAgentBatch(client, classId, ops)
    await commitOperation(client, saveRule(classId, { rule_id: ruleA, amount: 10 }, 1))
    await client.query(`
      UPDATE ppt.students SET enrollment_status = 'transferred' WHERE class_id = $1 AND student_id = $2
    `, [classId, studentIds[1]])
    await commitOperation(client, agentApplyRule({ classId, studentId: studentIds[2] }, ruleB))
    const outer = await commitOperation(client, approve())
    const codes = ['RULE_VERSION_STALE', 'ENTITY_INACTIVE', 'HELD_OP_OUTDATED', 'OK', 'OK', 'OK']
    const items = ops.map((op, index) => resultItem(op.op_id, codes[index]))
    expectBatchOutcome(outer, batch.call_id, items, 'confirmed')
    expect(await heldMemberRows(client, ops)).toEqual(items.map(item => expect.objectContaining({
      ...item, actor_kind: 'agent', actor_id: 'agent',
    })))
    const { rows } = await client.query(
      'SELECT op_id FROM ppt.transactions WHERE op_id = ANY($1::text[]) ORDER BY op_id',
      [ops.map(op => op.op_id)],
    )
    expect(rows.map(row => row.op_id)).toEqual(ops.slice(3).map(op => op.op_id).sort())
  })

  test('03:419 同一批內重複套用只成立第一筆', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const rule = await addManualRule(client, fixture.classId)
    const ops = [agentApplyRule(fixture, rule), agentApplyRule(fixture, rule)]
    const { batch, approve } = await holdAgentBatch(client, fixture.classId, ops)
    expect(batch.receipts[0].result.held_reason).toBe('duplicate_rule_in_call')
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, [
      resultItem(ops[0].op_id), resultItem(ops[1].op_id, 'HELD_OP_OUTDATED'),
    ], 'confirmed')
    expect((await submissionData(client, fixture.classId)).transactions).toMatchObject([{ op_id: ops[0].op_id }])
  })

  test.each(['沒有沖回', '暫緩前沖回', '暫緩後沖回'])(
    '暫緩之前的套用照常成立並保留六鍵提示（%s）', async timing => {
      const { client } = db()
      const fixture = await addAgentClass(client)
      const { classId } = fixture
      const rule = await addManualRule(client, classId)
      const prior = await commitOperation(client, agentApplyRule(fixture, rule))
      const reversal = reverse(classId, prior.result.transactions[0], 5)
      if (timing === '暫緩前沖回') await commitOperation(client, reversal)
      const op = agentApplyRule(fixture, rule)
      const { batch, approve } = await holdAgentBatch(client, classId, [op])
      expect(batch.receipts[0].result.held_reason).toBe('rule_applied_today')
      if (timing === '暫緩後沖回') await commitOperation(client, reversal)
      await commitOperation(client, approve())
      const [row] = await heldMemberRows(client, [op])
      expect(row).toMatchObject({ status: 'committed', actor_kind: 'agent', actor_id: 'agent' })
      expect(row.receipt.warnings).toEqual([{
        code: 'POSSIBLE_DUPLICATE', student_id: fixture.studentId, rule_id: rule,
        prior_actor_kind: 'teacher', prior_op_id: prior.op_id, prior_at: prior.committed_at,
      }])
    },
  )

  test('確認可成立超單筆上限的套用，下一筆自行成立的交易不含該筆額度', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const first = agentApplyRule(fixture, await addManualRule(client, classId, 201))
    const next = agentApplyRule(fixture, await addManualRule(client, classId, 100))
    const { approve } = await holdAgentBatch(client, classId, [first])
    await commitOperation(client, approve())
    expect(await balanceOf(client, fixture)).toBe(201)
    expect((await agentSubmit(client, classId, [next])).receipts).toMatchObject([resultItem(next.op_id)])
    expect(await balanceOf(client, fixture)).toBe(301)
  })

  test('十分鐘人數排除已確認的一批，另外五位學生可自行提交', async () => {
    const { client } = db()
    const { classId, targets, approve } = await holdMissingSubmissions(client, 11)
    await commitOperation(client, approve())
    const next = targets.slice(6).map(target => setStatus(target, 'missing'))
    expect((await agentSubmit(client, classId, next)).receipts)
      .toMatchObject(next.map(op => resultItem(op.op_id)))
  })

  test('確認逐筆重驗繳交版本，只有暫緩期間被改過的一筆拒絕', async () => {
    const { client } = db()
    const { targets, ops, batch, approve } = await holdMissingSubmissions(client)
    await markSubmission(client, targets[0], 'on_time')
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, ops.map((op, index) =>
      resultItem(op.op_id, index === 0 ? 'STALE_STATE' : 'OK')), 'confirmed')
    expect(await submissionRow(client, targets[0])).toMatchObject({ status: 'on_time', rev: 2 })
    expect(await balanceOf(client, targets[0])).toBe(0)
  })

  test('同批 after_op 可接前一筆的最終收據，兩筆確認且只扣一次', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [target] = await addAgentTask(client, fixture, -5)
    await setAgentLimits(client, classId, { max_points_per_tx: 1 })
    const first = setStatus(target, 'missing')
    const second = setStatus(target, 'makeup', { after_op: first.op_id })
    const before = await submissionData(client, classId)
    const { batch, approve } = await holdAgentBatch(client, classId, [first, second])
    expect(batch.receipts[0].result.held_reason).toBe('max_points_per_tx')
    expect(await submissionData(client, classId)).toEqual(before)
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, [resultItem(first.op_id), resultItem(second.op_id)], 'confirmed')
    expect((await submissionData(client, classId)).transactions).toMatchObject([{ op_id: first.op_id }])
    expect(await submissionRow(client, target)).toMatchObject({ status: 'makeup', rev: 3, basis_rev: 3 })
    expect(await balanceOf(client, target)).toBe(-5)
  })

  test('退回每筆暫緩操作，僅改待確認項目與收據', async () => {
    const { client } = db()
    const { classId, ops, batch, reject } = await holdMissingSubmissions(client)
    const before = await submissionData(client, classId)
    const outer = await commitOperation(client, reject())
    const items = ops.map(op => resultItem(op.op_id, 'CONFIRMATION_REJECTED'))
    expectBatchOutcome(outer, batch.call_id, items, 'rejected')
    expect(await heldMemberRows(client, ops)).toMatchObject(items.map(item => ({
      ...item, actor_kind: 'agent', batch_id: batch.call_id, class_seq: null, committed_at: null,
    })))
    for (const { receipt } of await heldMemberRows(client, ops)) expect(receipt).not.toHaveProperty('current')
    expect(await submissionData(client, classId)).toEqual(before)
    expect(await confirmationsFor(client, classId)).toMatchObject([
      { status: 'rejected', processed_op_id: outer.op_id },
    ])
  })

  test.each(['approve', 'reject'])('已用 %s 處理的批次不能再確認或退回，原呼叫重播終態', async action => {
    const { client } = db()
    const held = await holdMissingSubmissions(client)
    const { classId, ops, batch, approve, reject } = held
    await commitOperation(client, held[action]())
    const rows = await heldMemberRows(client, ops)
    expect(rows.map(row => row.code)).toEqual(Array(6).fill(action === 'approve' ? 'OK' : 'CONFIRMATION_REJECTED'))
    const before = await classSnapshot(client, classId)
    for (const op of [approve(), reject()]) {
      expect(await submit(client, op)).toMatchObject({ status: 'rejected', code: 'CONFIRMATION_NOT_PENDING' })
    }
    await expectFinalReplay(client, classId, batch.call_id, ops, rows)
    expect(await classSnapshot(client, classId)).toBe(before)
    expect(await heldMemberRows(client, ops)).toEqual(rows)
  })

  test('03:418 確認混合呼叫只執行這批新操作，舊操作留在舊批次', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 7)
    const { classId } = fixture
    const [first, ...remaining] = await addAgentTask(client, fixture, -5)
    const oldOp = setStatus(first, 'missing')
    const oldBatch = await agentSubmit(client, classId, [oldOp])
    expect(oldBatch.receipts).toMatchObject([resultItem(oldOp.op_id)])
    const ops = remaining.map(target => setStatus(target, 'missing'))
    const input = [ops[0], oldOp, ...ops.slice(1)]
    const { batch, approve } = await holdAgentBatch(client, classId, input, ops)
    expect(batch.receipts[1]).toEqual({ ...oldBatch.receipts[0], replayed: true })
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, ops.map(op => resultItem(op.op_id)), 'confirmed')
    const rows = await heldMemberRows(client, input)
    expect(rows[1]).toMatchObject({ batch_id: oldBatch.call_id, receipt: oldBatch.receipts[0] })
    await expectFinalReplay(client, classId, batch.call_id, input, rows)
  })

  test('待確認成員不可撤銷，確認後可由小野或老師單筆撤銷，OP-16 自身不可撤', async () => {
    const { client } = db()
    const { classId, ops, approve } = await holdMissingSubmissions(client)
    const pendingTeacherUndo = undo(classId, ops[0].op_id)
    const pendingAgentUndo = undo(classId, ops[0].op_id)
    expect(await submit(client, pendingTeacherUndo)).toMatchObject({ code: 'NOT_UNDOABLE' })
    expect((await agentSubmit(client, classId, [pendingAgentUndo])).receipts).toMatchObject([
      { code: 'NOT_UNDOABLE' },
    ])
    const outer = await commitOperation(client, approve())
    const memberUndo = undo(classId, ops[0].op_id)
    expect((await agentSubmit(client, classId, [memberUndo])).receipts).toMatchObject([resultItem(memberUndo.op_id)])
    await commitOperation(client, undo(classId, ops[1].op_id))
    expect(await submit(client, undo(classId, outer.op_id))).toMatchObject({ code: 'NOT_UNDOABLE' })
  })

  test('退回的 OP-17 自身不可撤銷', async () => {
    const { client } = db()
    const { classId, reject } = await holdMissingSubmissions(client)
    const outer = await commitOperation(client, reject())
    expect(await submit(client, undo(classId, outer.op_id))).toMatchObject({ code: 'NOT_UNDOABLE' })
  })

  test('退回釋放待確認名額，使用被拒收的原編號重送可暫緩', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    await setAgentLimits(client, classId, { max_pending_held: 2 })
    const first = agentApplyRule(fixture, await addManualRule(client, classId, 201))
    const second = agentApplyRule(fixture, await addManualRule(client, classId, 202))
    const third = agentApplyRule(fixture, await addManualRule(client, classId, 203))
    const { reject } = await holdAgentBatch(client, classId, [first])
    await holdAgentBatch(client, classId, [second])
    const blocked = await agentSubmit(client, classId, [third])
    expect(blocked).toEqual({ call_id: expect.any(String), status: 'retry', code: 'HELD_QUEUE_FULL' })
    expect(await agentCallRow(client, blocked.call_id)).toBeUndefined()
    await commitOperation(client, reject())
    expect((await agentSubmit(client, classId, [third], blocked.call_id)).receipts).toMatchObject([
      { op_id: third.op_id, status: 'held', code: 'HELD_FOR_TEACHER' },
    ])
  })

  test('兩連線競爭確認與退回十次，每輪只有一個外層操作成立', async () => {
    const { client, connect } = db()
    const other = await connect()
    for (let round = 0; round < 10; round += 1) {
      const { classId, ops, approve, reject } = await holdMissingSubmissions(client)
      const startSeq = await classSequence(client, classId)
      const [approved, rejected] = await Promise.all([submit(client, approve()), submit(other, reject())])
      expect([approved.code, rejected.code].sort()).toEqual(['CONFIRMATION_NOT_PENDING', 'OK'])
      const confirmed = approved.code === 'OK'
      const winner = confirmed ? approved : rejected
      expect(await confirmationsFor(client, classId)).toMatchObject([{
        status: confirmed ? 'confirmed' : 'rejected', processed_op_id: winner.op_id,
      }])
      const rows = await heldMemberRows(client, ops)
      expect(rows).toMatchObject(ops.map((op, index) => ({
        ...resultItem(op.op_id, confirmed ? 'OK' : 'CONFIRMATION_REJECTED'),
        class_seq: confirmed ? startSeq + index + 1 : null,
      })))
      expect(await classSequence(client, classId)).toBe(startSeq + (confirmed ? 7 : 1))
    }
  })

  test('保存正規化後的完整輸入，保留型別、額外鍵與明傳 null', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const good = agentApplyRule(fixture, await addManualRule(client, classId, 201))
    const invalid = {
      ...agentApplyRule(fixture, await addManualRule(client, classId, 10)),
      class_id: '會由入口覆寫', batch_id: '會由入口覆寫',
      expect: null, client_time: null, client_seq: { ordinal: 2 }, extra: { value: true },
    }
    const unknown = { ...agentApplyRule(fixture, invalid.payload.rule_id), type: ['points.apply_rule'], client_time: 42 }
    const ops = [good, invalid, unknown]
    const { batch, approve } = await holdAgentBatch(client, classId, ops)
    const call = await agentCallRow(client, batch.call_id)
    expect(call.held_inputs).toEqual(ops.map(op => ({ ...op, class_id: classId, batch_id: batch.call_id })))
    expect(call.entries.map(entry => Object.keys(entry).sort()))
      .toEqual(ops.map(() => ['content_hash', 'is_new', 'op_id']))
    const outer = await commitOperation(client, approve())
    expectBatchOutcome(outer, batch.call_id, [
      resultItem(good.op_id), resultItem(invalid.op_id, 'INVALID_PAYLOAD'),
      resultItem(unknown.op_id, 'UNKNOWN_OP_TYPE'),
    ], 'confirmed')
    const ordinary = agentApplyRule(fixture, invalid.payload.rule_id)
    const ordinaryBatch = await agentSubmit(client, classId, [ordinary])
    expect(ordinaryBatch.receipts).toMatchObject([resultItem(ordinary.op_id)])
    expect((await agentCallRow(client, ordinaryBatch.call_id)).held_inputs).toBeNull()
  })

  test('完整輸入欄位遺失時確認丟一般例外，整筆回復', async () => {
    const { client } = db()
    const { classId, ops, batch, approve } = await holdMissingSubmissions(client)
    await client.query('UPDATE ppt.agent_calls SET held_inputs = NULL WHERE call_id = $1', [batch.call_id])
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    const members = await heldMemberRows(client, ops)
    await expect(submit(client, approve())).rejects.toMatchObject({ code: 'P0001' })
    expect(await classSnapshot(client, classId)).toBe(before)
    expect(await operationCount(client)).toBe(count)
    expect(await heldMemberRows(client, ops)).toEqual(members)
  })
})
