import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, cancel, submit } from './test-support/operations.js'
import { commitOperation, operation, retireRule, saveRule } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

async function adjust(client, target, amount = 100) {
  const receipt = await commitOperation(client, adjustment(target, amount))
  return { receipt, root: await transactionFrom(client, receipt) }
}

function applyManualRule(target, rule) {
  return operation(target.classId, 'points.apply_rule', {
    student_id: target.studentId, rule_id: rule.payload.rule_id, rule_version: 1,
  })
}

async function sendAgent(client, target, op) {
  const { receipts: [receipt] } = await agentSubmit(client, target.classId, [op])
  return receipt
}

function expectUndoWarning(receipt, array, reason, expected) {
  const detail = { effect_id: null, lineage_id: null, ...expected }
  expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: reason, ...detail }])
  expect(receipt.result.undo[array]).toEqual([detail])
}

async function rejectUndo(client, classId, targetId, code) {
  const before = await classSnapshot(client, classId)
  const receipt = await submit(client, undo(classId, targetId))
  expect(receipt).toMatchObject({ status: 'rejected', code })
  expect(await classSnapshot(client, classId)).toBe(before)
  return receipt
}

describeDatabase('撤銷交易與共通前提', () => {
  const database = useTestDatabase()

  test('OP-24 整筆沖回，同編號重播，另一編號不得再撤', async () => {
    const { client } = database()
    const target = await addClass(client)
    const { receipt, root } = await adjust(client, target)
    const op = undo(target.classId, receipt.op_id)
    const undone = await commitOperation(client, op)
    expect(await transactionFrom(client, undone)).toMatchObject({
      kind: 'reversal', amount: '-100', earned_delta: '-100',
      root_transaction_id: root.transaction_id, effective_at: root.effective_at,
    })
    expect(undone.changes).toEqual([expect.objectContaining({
      entity: 'account', value: { balance: 0, total_earned: 0 },
    })])
    expect(undone.result.undo).toEqual({ target_op_id: receipt.op_id, skipped: [], amount_changed: [] })
    expect(undone.warnings).toEqual([])
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, op)).toEqual({ ...undone, replayed: true })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    await rejectUndo(client, target.classId, receipt.op_id, 'ALREADY_UNDONE')
  })

  test('OP-25 撤銷沿用原交易，改版並停用規則仍沖回原額', async () => {
    const { client } = database()
    const target = await addClass(client)
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    const applied = await commitOperation(client, applyManualRule(target, rule))
    await commitOperation(client, saveRule(target.classId, { ...rule.payload, amount: 7 }, 1))
    await commitOperation(client, retireRule(target.classId, rule.payload.rule_id, 2))
    const undone = await commitOperation(client, undo(target.classId, applied.op_id))
    expect(await transactionFrom(client, undone)).toMatchObject({
      kind: 'reversal', amount: '-5', root_transaction_id: applied.result.transactions[0],
    })
    expect(undone.warnings).toEqual([])
  })

  test.each([80, 0])('按更正後金額 %i 沖回並附提示', async (amount) => {
    const { client } = database()
    const target = await addClass(client)
    const { receipt, root } = await adjust(client, target)
    const correction = await commitOperation(client, correct(target.classId, root.transaction_id, 100, amount))
    const undone = await commitOperation(client, undo(target.classId, receipt.op_id))
    expect(await transactionFrom(client, undone)).toMatchObject({
      kind: 'reversal', amount: String(-amount), root_transaction_id: root.transaction_id,
    })
    expectUndoWarning(undone, 'amount_changed', 'amount_changed', {
      transaction_id: root.transaction_id, changed_by_op_id: correction.op_id, original_amount: 100, amount,
    })
    expect(undone.result.undo.skipped).toEqual([])
    for (const followUp of [correct(target.classId, root.transaction_id, 0, 1), reverse(target.classId, root.transaction_id, 0)]) {
      expect(await submit(client, followUp)).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    }
  })

  test('已單獨沖回時撤銷成立且不改資料，仍占用原操作', async () => {
    const { client } = database()
    const target = await addClass(client)
    const { receipt, root } = await adjust(client, target)
    const reversal = await commitOperation(client, reverse(target.classId, root.transaction_id, 100))
    const before = await classSnapshot(client, target.classId, { ignoreClassSequence: true })
    const undone = await commitOperation(client, undo(target.classId, receipt.op_id))
    expect(undone.result).toMatchObject({ noop: true, transactions: [], effects_added: [], effects_reversed: [] })
    expect(undone.changes).toEqual([])
    expect(undone.class_seq).toBe(reversal.class_seq + 1)
    expectUndoWarning(undone, 'skipped', 'already_reversed', {
      transaction_id: root.transaction_id, changed_by_op_id: reversal.op_id, original_amount: 100, amount: null,
    })
    expect(undone.result.undo.amount_changed).toEqual([])
    expect(await classSnapshot(client, target.classId, { ignoreClassSequence: true })).toBe(before)
    await rejectUndo(client, target.classId, receipt.op_id, 'ALREADY_UNDONE')
  })

  test('拒絕撤銷被拒、放棄、暫緩、成立的撤銷與本身', async () => {
    const { client } = database()
    const target = await addClass(client)
    const rejected = await submit(client, adjustment(target, 0))
    const cancelledId = randomUUID()
    expect(await cancel(client, target.classId, cancelledId)).toMatchObject({ status: 'cancelled' })
    const heldId = randomUUID()
    await client.query(`
      INSERT INTO ppt.operations (class_id, op_id, actor_kind, actor_id, type, status, recorded_at, content_hash)
      VALUES ($1, $2, 'agent', 'agent', 'points.apply_rule', 'held', clock_timestamp(), sha256('held'::bytea))
    `, [target.classId, heldId])
    const { receipt } = await adjust(client, target)
    const undone = await commitOperation(client, undo(target.classId, receipt.op_id))
    for (const id of [rejected.op_id, cancelledId, heldId, undone.op_id]) {
      await rejectUndo(client, target.classId, id, 'NOT_UNDOABLE')
    }
    const op = undo(target.classId, 'self')
    op.payload.target_op_id = op.op_id
    expect(await submit(client, op)).toMatchObject({ status: 'rejected', code: 'NOT_UNDOABLE' })
  })

  test('老師撤查不到的操作回 NOT_FOUND，沒有 current', async () => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await rejectUndo(client, target.classId, 'unknown-operation', 'NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  })

  test('小野只能撤自己的 OP-25，老師可撤小野的操作', async () => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    const teacherOp = await commitOperation(client, applyManualRule(target, rule))
    const agentOp = await sendAgent(client, target, applyManualRule(target, rule))
    expect(agentOp.code).toBe('OK')
    const agentUndo = await sendAgent(client, target, undo(target.classId, agentOp.op_id))
    expect(agentUndo).toMatchObject({ code: 'OK', result: { undo: { target_op_id: agentOp.op_id } } })
    const { rows: [actor] } = await client.query(
      'SELECT actor_kind, actor_id FROM ppt.operations WHERE op_id = $1', [agentUndo.op_id],
    )
    expect(actor).toEqual({ actor_kind: 'agent', actor_id: 'agent' })
    const forbidden = await sendAgent(client, target, undo(target.classId, teacherOp.op_id))
    const absent = await sendAgent(client, target, undo(target.classId, 'unknown-operation'))
    expect(forbidden).toMatchObject({ status: 'rejected', code: 'SCOPE_FORBIDDEN' })
    expect(forbidden).not.toHaveProperty('current')
    expect(absent).toEqual({ ...forbidden, op_id: absent.op_id })
    const secondAgentOp = await sendAgent(client, target, applyManualRule(target, rule))
    await commitOperation(client, undo(target.classId, secondAgentOp.op_id))
  })

  test('學生轉出仍可撤銷 OP-24', async () => {
    const { client } = database()
    const target = await addClass(client)
    const { receipt } = await adjust(client, target)
    await client.query("UPDATE ppt.students SET enrollment_status = 'transferred' WHERE class_id = $1", [target.classId])
    const undone = await commitOperation(client, undo(target.classId, receipt.op_id))
    expect(undone.changes[0].value.balance).toBe(0)
  })

  test.each([
    ['缺目標', { payload: {} }],
    ['空字串', { payload: { target_op_id: '' } }],
    ['非字串', { payload: { target_op_id: 1 } }],
    ['多餘鍵', { payload: { target_op_id: 'unknown', other: true } }],
    ['版本物件', { expect: { rev: 1 } }],
    ['版本 null', { expect: null }],
  ])('拒絕無效輸入 %s', async (_label, fields) => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await submit(client, { ...undo(target.classId, 'unknown'), ...fields })
    expect(receipt).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
  })
})
