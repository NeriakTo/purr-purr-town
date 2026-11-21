import { expect, test } from 'vitest'
import { addAgentClass, addAgentTask } from './test-support/agent-fixtures.js'
import { holdAgentBatch, holdMissingSubmissions } from './test-support/agent-held.js'
import { agentSubmit } from './test-support/agent.js'
import { injectBatchUndoFailure, removeBatchUndoFailure } from './test-support/batch-undo-failure.js'
import { batchUndo, batchUndoRows, ruleBatch } from './test-support/batch-undo.js'
import { batchUndoId } from './test-support/batch-uuid.js'
import { classSnapshot } from './test-support/checks.js'
import { confirm } from './test-support/confirmations.js'
import { adjustment, operationCount, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { effectRow, expectSubmissionState, missingEvent } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

const startingBalance = 100
const missingAmount = -5

async function setupBatchSubmission(client) {
  const fixture = await addAgentClass(client)
  const [target] = await addAgentTask(client, fixture, missingAmount)
  await commitOperation(client, adjustment(target, startingBalance))
  return target
}

async function submitLinkedAgentBatch(client, target) {
  const missing = setStatus(target, 'missing')
  const makeup = setStatus(target, 'makeup', { after_op: missing.op_id })
  const batch = await agentSubmit(client, target.classId, [missing, makeup])
  expect(batch.receipts.map(receipt => receipt.code)).toEqual(['OK', 'OK'])
  return { missing, makeup, batch, op: batchUndo(target.classId, batch.call_id, 2) }
}

function expectSubmissionStep(receipt, rev, basis, status) {
  expect(receipt.changes[0]).toMatchObject({
    entity: 'submission', rev, basis_rev: basis, value: { status, assignment_active: true },
  })
}

async function expectRolledBackBatch(client, classId, op, memberIds) {
  const before = await classSnapshot(client, classId)
  const count = await operationCount(client)
  await injectBatchUndoFailure(client)
  try {
    await expect(submit(client, op)).rejects.toMatchObject({
      code: 'P0001', message: '測試注入整批撤銷沖回失敗',
    })
  } finally {
    await removeBatchUndoFailure(client)
  }
  expect(await classSnapshot(client, classId)).toBe(before)
  expect(await operationCount(client)).toBe(count)
  expect(await batchUndoRows(client, [op.op_id, ...memberIds])).toEqual([])
}

describeDatabase('小野整批撤銷驗收', () => {
  const db = useTestDatabase()

  test('S2 同批缺交再補交，倒序撤銷逐步回復基準與餘額', async () => {
    const { client } = db()
    const target = await setupBatchSubmission(client)
    const { classId } = target
    const deductedBalance = startingBalance + missingAmount
    await expectSubmissionState(client, target, 1, 1, 'pending', startingBalance)
    const { missing, makeup, batch, op } = await submitLinkedAgentBatch(client, target)
    const [a, b] = batch.receipts
    const [effect] = a.result.effects_added
    expectSubmissionStep(a, 2, 2, 'missing')
    expect(a.changes.find(change => change.entity === 'account')).toMatchObject({
      prev_value: { balance: startingBalance }, value: { balance: deductedBalance },
    })
    expect(effect).toMatchObject({ event: missingEvent, amount: missingAmount })
    expect(await transactionFrom(client, a)).toMatchObject({ amount: String(missingAmount) })
    expectSubmissionStep(b, 3, 3, 'makeup')
    expect(b.changes).toHaveLength(1)
    expect(b.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })
    await expectSubmissionState(client, target, 3, 3, 'makeup', deductedBalance, [[missingEvent, missingAmount]])

    const outer = await commitOperation(client, op)
    const ids = [makeup, missing].map(targetOp => batchUndoId(op.op_id, targetOp.op_id))
    expect(outer.result.items.map(item => item.undo_op_id)).toEqual(ids)
    const [undoB, undoA] = (await batchUndoRows(client, ids)).map(row => row.receipt)
    expectSubmissionStep(undoB, 4, 2, 'missing')
    expect(undoB.changes).toHaveLength(1)
    expect(undoB.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })

    expectSubmissionStep(undoA, 5, 1, 'pending')
    expect(undoA.changes.find(change => change.entity === 'account')).toMatchObject({
      prev_value: { balance: deductedBalance }, value: { balance: startingBalance },
    })
    expect(undoA.result.effects_reversed).toMatchObject([{ effect_id: effect.effect_id, effective_amount: missingAmount }])
    expect(await transactionFrom(client, undoA)).toMatchObject({
      amount: String(-missingAmount), root_transaction_id: effect.root_transaction_id,
    })
    await expectSubmissionState(client, target, 5, 1, 'pending', startingBalance)
    expect((await submit(client, undo(classId, missing.op_id))).code).toBe('ALREADY_UNDONE')
  })

  test('16.3 第 6 條第二筆沖回失敗使整批回復，同編號重送只成立一次', async () => {
    const { client } = db()
    const target = await setupBatchSubmission(client)
    const { classId } = target
    const { missing, makeup, op } = await submitLinkedAgentBatch(client, target)
    const ids = [makeup, missing].map(targetOp => batchUndoId(op.op_id, targetOp.op_id))
    await expectRolledBackBatch(client, classId, op, ids)
    await expectSubmissionState(client, target, 3, 3, 'makeup', startingBalance + missingAmount, [[missingEvent, missingAmount]])

    const probe = await setupBatchSubmission(client)
    const probeBatch = await submitLinkedAgentBatch(client, probe)
    const probeIds = [probeBatch.makeup, probeBatch.missing].map(targetOp => batchUndoId(probeBatch.op.op_id, targetOp.op_id))
    await expectRolledBackBatch(client, probe.classId, probeBatch.op, probeIds)
    await commitOperation(client, undo(probe.classId, probeBatch.makeup.op_id))

    const result = await commitOperation(client, op)
    expect(result.result.items.map(item => item.undo_op_id)).toEqual(ids)
    const { rows } = await client.query(`
      SELECT payload->>'target_op_id' AS target_id, count(*)::int AS count FROM ppt.operations
      WHERE class_id = $1 AND type = 'op.undo' AND status = 'committed'
      GROUP BY target_id ORDER BY target_id
    `, [classId])
    expect(rows).toEqual([missing.op_id, makeup.op_id].sort().map(target_id => ({ target_id, count: 1 })))
    await expectSubmissionState(client, target, 5, 1, 'pending', startingBalance)
    const count = await operationCount(client)
    expect(await submit(client, op)).toEqual({ ...result, replayed: true })
    expect(await operationCount(client)).toBe(count)
  })

  test('16.3 第 10 條跳過小野的撤銷本身與已撤銷原操作', async () => {
    const { client } = db()
    const target = await setupBatchSubmission(client)
    const { classId } = target
    const missing = setStatus(target, 'missing')
    const first = await agentSubmit(client, classId, [missing])
    const agentUndo = undo(classId, missing.op_id)
    const second = await agentSubmit(client, classId, [agentUndo])
    expect(first.receipts[0].code).toBe('OK')
    expect(second.receipts[0].code).toBe('OK')
    const before = await classSnapshot(client, classId, { ignoreClassSequence: true })

    for (const [batch, op, code] of [[second, agentUndo, 'NOT_UNDOABLE'], [first, missing, 'ALREADY_UNDONE']]) {
      const receipt = await commitOperation(client, batchUndo(classId, batch.call_id))
      expect(receipt.result).toEqual({
        noop: true, transactions: [], effects_added: [], effects_reversed: [],
        batch: { batch_id: batch.call_id, op_count: 1 },
        items: [{ target_op_id: op.op_id, outcome: 'skipped', undo_op_id: batchUndoId(receipt.op_id, op.op_id), code }],
      })
      expect(receipt.changes).toEqual([])
      expect(await classSnapshot(client, classId, { ignoreClassSequence: true })).toBe(before)
    }
    await expectSubmissionState(client, target, 3, 1, 'pending', startingBalance)
  })

  test('03:429 ④ 整批撤銷寫唯一零元沖回並關閉有效缺交效果', async () => {
    const { client } = db()
    const target = await setupBatchSubmission(client)
    const { classId } = target
    const op = setStatus(target, 'missing')
    const batch = await agentSubmit(client, classId, [op])
    const [original] = batch.receipts
    expect(original.code).toBe('OK')
    const [effect] = original.result.effects_added
    const root = effect.root_transaction_id
    const correction = await commitOperation(client, correct(classId, root, missingAmount, 0))
    await expectSubmissionState(client, target, 2, 2, 'missing', startingBalance, [[missingEvent, 0]])
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id))
    const internalId = batchUndoId(outer.op_id, op.op_id)
    const [{ receipt }] = await batchUndoRows(client, [internalId])
    expect(outer.result.noop).toBe(false)
    expect(outer.warnings).toEqual([{
      code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'amount_changed', target_op_id: op.op_id,
      effect_id: effect.effect_id, lineage_id: effect.lineage_id, transaction_id: root,
      changed_by_op_id: correction.op_id, original_amount: missingAmount, amount: 0,
    }])
    expect(receipt.result.transactions).toHaveLength(1)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'reversal', root_transaction_id: root, amount: '0', earned_delta: '0',
    })
    const { rows } = await client.query(`
      SELECT transaction_id FROM ppt.transactions WHERE class_id = $1 AND root_transaction_id = $2 AND kind = 'reversal'
    `, [classId, root])
    expect(rows).toEqual([{ transaction_id: receipt.result.transactions[0] }])
    expect(await effectRow(client, classId, effect.effect_id)).toMatchObject({
      status: 'reversed', reversed_op_id: internalId,
    })
    await expectSubmissionState(client, target, 3, 1, 'pending', startingBalance)
    expect((await submit(client, correct(classId, root, 0, -1))).code).toBe('TX_ALREADY_REVERSED')
    expect((await submit(client, reverse(classId, root, 0))).code).toBe('TX_ALREADY_REVERSED')
  })

  test('03:418 既有成員留舊批次，確認、重播與撤銷只處理六筆新成員', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 7)
    const { classId } = fixture
    const targets = await addAgentTask(client, fixture, missingAmount)
    const [oldOp, ...newOps] = targets.map(target => setStatus(target, 'missing'))
    const oldBatch = await agentSubmit(client, classId, [oldOp])
    const ops = [oldOp, ...newOps]
    const { batch, approve } = await holdAgentBatch(client, classId, ops, newOps)
    expect(batch.receipts[0]).toEqual({ ...oldBatch.receipts[0], replayed: true })
    const oldRows = await batchUndoRows(client, [oldOp.op_id])
    expect(oldRows).toMatchObject([{ batch_id: oldBatch.call_id, status: 'committed' }])
    expect(await agentSubmit(client, classId, [oldOp, oldOp], batch.call_id)).toEqual({
      call_id: batch.call_id, status: 'retry', code: 'BAD_ENVELOPE',
    })

    const approval = await commitOperation(client, approve())
    expect(approval.result.held.items).toEqual(newOps.map(op => ({ op_id: op.op_id, status: 'committed', code: 'OK' })))
    expect(await agentSubmit(client, classId, ops, batch.call_id)).toEqual({
      call_id: batch.call_id,
      receipts: (await batchUndoRows(client, ops.map(op => op.op_id))).map(row => ({ ...row.receipt, replayed: true })),
    })
    expect(await submit(client, batchUndo(classId, batch.call_id, 7))).toMatchObject({
      status: 'rejected', code: 'STALE_STATE', current: { op_count: 6 },
    })
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id, 6))
    expect(outer.result.items).toEqual(newOps.toReversed().map(op => ({
      target_op_id: op.op_id, outcome: 'undone', undo_op_id: batchUndoId(outer.op_id, op.op_id),
    })))
    expect(await batchUndoRows(client, [oldOp.op_id])).toEqual(oldRows)
    await expectSubmissionState(client, targets[0], 2, 2, 'missing', missingAmount, [[missingEvent, missingAmount]])
    for (const target of targets.slice(1)) await expectSubmissionState(client, target, 3, 1, 'pending', 0)
  })

  test('03:376 同一老師跨班也查不到小野批次或待確認項目', async () => {
    const { client } = db()
    const first = await addAgentClass(client)
    const second = await holdMissingSubmissions(client)
    const { batch } = await ruleBatch(client, 1, second)
    const before = await classSnapshot(client, second.classId)
    const beforeRows = await batchUndoRows(client, [...second.ops.map(op => op.op_id), batch.receipts[0].op_id])
    const confirmationId = second.ops[0].op_id
    for (const op of [
      batchUndo(first.classId, batch.call_id),
      confirm(first.classId, confirmationId),
      confirm(first.classId, confirmationId, 'confirmation.reject'),
    ]) {
      const receipt = await submit(client, op)
      expect(receipt).toMatchObject({ status: 'rejected', code: 'NOT_FOUND', class_seq: null })
      expect(receipt).not.toHaveProperty('current')
    }
    expect(await classSnapshot(client, second.classId)).toBe(before)
    expect(await batchUndoRows(client, beforeRows.map(row => row.op_id))).toEqual(beforeRows)
  })
})
