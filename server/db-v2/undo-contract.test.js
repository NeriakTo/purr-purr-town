import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { confirm, propose } from './test-support/confirmations.js'
import { setCorrectionDueOperation, setupOpenRoundConflict } from './test-support/correction-rounds.js'
import { useItem as inventoryUse } from './test-support/inventory.js'
import { addImportedEffect, addImportedSubmission, addImportedTask, resolveLegacyEffect } from './test-support/legacy-effects.js'
import { addClass, adjustment, classSequence, operationCount, submit, teacher } from './test-support/operations.js'
import { addPayrollJob, assignJob, payrollDay, retireJob, saveJob, setDuty } from './test-support/payroll.js'
import { retireProduct, saveProduct } from './test-support/products.js'
import { commitOperation, createTask, restoreTask, retireRule, saveRule, updateTask, voidTask } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { assignTask, markSubmission } from './test-support/submission-flow.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse } from './test-support/transactions.js'
import { setupEffectConflict } from './test-support/undo-effects.js'
import { buyForUndo, rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { setupSubmissionUndo } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

async function basisConflict(client) {
  const { target } = await setupSubmissionUndo(client)
  const original = await markSubmission(client, target, 'missing')
  const later = await markSubmission(client, target, 'late', 2)
  return { target, original, current: submissionCurrent(later) }
}

function submissionCurrent(receipt) {
  const [change] = receipt.changes
  return {
    value: change.value, rev: change.rev, basis_rev: change.basis_rev,
    last_op_id: receipt.op_id, actor: teacher, committed_at: receipt.committed_at,
  }
}

async function effectConflict(client) {
  const { target, missing, effectId } = await setupEffectConflict(client)
  return { target, original: missing, current: { ...submissionCurrent(missing), effect_id: effectId } }
}

async function correctionConflict(client) {
  const target = await addClass(client)
  const adjusted = await commitOperation(client, adjustment(target, 10))
  const [rootId] = adjusted.result.transactions
  const original = await commitOperation(client, correct(target.classId, rootId, 10, 8))
  const later = await commitOperation(client, correct(target.classId, rootId, 8, 5))
  return { target, original, current: {
    transaction_id: rootId, effective_amount: 5, reversed: false, last_op_id: later.op_id,
    actor: teacher, committed_at: later.committed_at,
  } }
}

async function itemConflict(client) {
  const target = await buyForUndo(client, await addClass(client))
  const used = await commitOperation(client, inventoryUse(target.classId, target.itemId))
  return { target, original: target.purchase, current: {
    value: { status: 'used' }, rev: 2, last_op_id: used.op_id, actor: teacher, committed_at: used.committed_at,
  } }
}

async function undoRecords(client, classId, targetOpId) {
  const { rows } = await client.query(`
    SELECT op_id, status, code, class_seq FROM ppt.operations
    WHERE class_id = $1 AND type = 'op.undo' AND payload->>'target_op_id' = $2
  `, [classId, targetOpId])
  return rows
}

async function taskOperation(client, target, makeOperation) {
  const { taskId } = await assignTask(client, target)
  return makeOperation(target.classId, taskId)
}

async function restoreVoidedTask(client, target) {
  const { classId, taskId } = await assignTask(client, target)
  await commitOperation(client, voidTask(classId, taskId, false))
  return restoreTask(classId, taskId)
}

async function proposalOperation(client, target, reject = false) {
  const assigned = await assignTask(client, target)
  const operation = propose(assigned, 'missing')
  if (!reject) return operation
  const proposal = await commitOperation(client, operation)
  return confirm(target.classId, proposal.op_id, 'confirmation.reject')
}

async function reverseOperation(client, target) {
  const original = await commitOperation(client, adjustment(target, 10))
  return reverse(target.classId, original.result.transactions[0], 10)
}

async function retireProductOperation(client, target) {
  const operation = saveProduct(target.classId)
  await commitOperation(client, operation)
  return retireProduct(target.classId, operation.payload.product_id, 1)
}

async function retireRuleOperation(client, target) {
  const operation = saveRule(target.classId)
  await commitOperation(client, operation)
  return retireRule(target.classId, operation.payload.rule_id, 1)
}

const nonUndoable = [
  ['OP-10', (_client, target) => createTask(target.classId)],
  ['OP-11', (client, target) => taskOperation(client, target, (classId, taskId) => updateTask(classId, taskId, { title: '改名作業' }))],
  ['OP-12', (client, target) => taskOperation(client, target, (classId, taskId) => voidTask(classId, taskId, false))],
  ['OP-13', restoreVoidedTask],
  ['OP-15', proposalOperation],
  ['OP-17', (client, target) => proposalOperation(client, target, true)],
  ['OP-27', reverseOperation],
  ['OP-33', (_client, target) => saveProduct(target.classId)],
  ['OP-34', retireProductOperation],
  ['OP-38', (_client, target) => saveRule(target.classId)],
  ['OP-39', retireRuleOperation],
  ['OP-43', (_client, target) => setSetting(target.classId, 'taskTypes', ['作業'])],
  ['OP-23', setCorrectionDueOperation],
  ['OP-53', async (client, target) => {
    const imported = { ...target, taskId: await addImportedTask(client, target.classId) }
    await addImportedSubmission(client, imported, 'missing')
    imported.effectId = await addImportedEffect(client, imported)
    return resolveLegacyEffect(imported, 'none')
  }],
  ['OP-29', (_client, target) => setDuty(target.classId, payrollDay, [target.studentId])],
  ['OP-35', (_client, target) => saveJob(target.classId)],
  ['OP-36', async (client, target) => {
    const jobId = await addPayrollJob(client, target.classId, [target.studentId])
    return retireJob(target.classId, jobId, { rev: 2 })
  }],
  ['OP-37', async (client, target) => {
    const op = saveJob(target.classId)
    await commitOperation(client, op)
    return assignJob(target.classId, op.payload.job_id, [target.studentId])
  }],
]

describeDatabase('撤銷乙段驗收', () => {
  const db = useTestDatabase()

  test.each([
    ['basis_changed', basisConflict], ['effect_already_active', effectConflict],
    ['tx_changed_later', correctionConflict], ['item_state_changed', itemConflict],
    ['open_round_exists', setupOpenRoundConflict],
  ])('03:412 %s 預檢拒絕只留一列且不佔用撤銷', async (reason, arrange) => {
    const { client } = db()
    const { target: { classId }, original, current } = await arrange(client)
    const op = undo(classId, original.op_id)
    const previous = await classSequence(client, classId)
    const count = await operationCount(client)
    expect(await undoRecords(client, classId, original.op_id)).toEqual([])
    const receipt = await rejectUndoWithoutChanges(client, op, 'UNDO_CONFLICT')
    expect(receipt.current).toEqual({ ...current, reason })
    expect(await classSequence(client, classId)).toBe(previous)
    expect(await operationCount(client)).toBe(count + 1)
    expect(await undoRecords(client, classId, original.op_id)).toEqual([
      { op_id: op.op_id, status: 'rejected', code: 'UNDO_CONFLICT', class_seq: null },
    ])
  })

  test('03:376 同一老師也不能跨班撤銷，原班仍可撤', async () => {
    const { client } = db()
    const a = await addClass(client)
    const b = await addClass(client)
    const original = await commitOperation(client, adjustment(b, 10))
    const before = await classSnapshot(client, b.classId)
    const rejected = await rejectUndoWithoutChanges(client, undo(a.classId, original.op_id), 'NOT_FOUND')
    expect(rejected).not.toHaveProperty('current')
    expect(await classSnapshot(client, b.classId)).toBe(before)
    await commitOperation(client, undo(b.classId, original.op_id))
  })

  test('封存班先回 CLASS_ARCHIVED，且資料不變', async () => {
    const { client } = db()
    const target = await addClass(client)
    const original = await commitOperation(client, adjustment(target, 10))
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [target.classId])
    const op = { ...undo(target.classId, original.op_id), expect: null }
    await rejectUndoWithoutChanges(client, op, 'CLASS_ARCHIVED')
  })

  test.each(['extra', 'expect', 'null expect'])('撤銷包含 %s 會回 INVALID_PAYLOAD', async (input) => {
    const { client } = db()
    const target = await addClass(client)
    const original = await commitOperation(client, adjustment(target, 10))
    const operation = undo(target.classId, original.op_id)
    if (input === 'extra') operation.payload.extra = true
    else operation.expect = input === 'expect' ? { rev: 1 } : null
    await rejectUndoWithoutChanges(client, operation, 'INVALID_PAYLOAD')
  })

  test.each(nonUndoable)('%s 成立後仍不可撤', async (_id, makeOperation) => {
    const { client } = db()
    const target = await addClass(client)
    const op = await makeOperation(client, target)
    const original = await commitOperation(client, op)
    await rejectUndoWithoutChanges(client, undo(target.classId, original.op_id), 'NOT_UNDOABLE')
  })

  test('兩條連線競爭二十次，每次只成立一次且只沖回一筆', async () => {
    const { client, connect } = db()
    const other = await connect()
    const target = await addClass(client)
    const { rows: indexes } = await client.query(`
      SELECT indisunique, indisvalid, pg_get_indexdef(indexrelid) AS definition
      FROM pg_index WHERE indexrelid = to_regclass('ppt.operations_one_committed_undo')
    `)
    expect(indexes).toMatchObject([{
      indisunique: true, indisvalid: true,
      definition: expect.stringMatching(/\bclass_id\b.*target_op_id.*WHERE.*op\.undo.*committed/),
    }])
    for (let i = 0; i < 20; i++) {
      const original = await commitOperation(client, adjustment(target, 10))
      const [first, second] = await Promise.all([
        submit(client, undo(target.classId, original.op_id)),
        submit(other, undo(target.classId, original.op_id)),
      ])
      expect([first.code, second.code].sort()).toEqual(['ALREADY_UNDONE', 'OK'])
      const { rows } = await client.query(`
        SELECT transaction_id FROM ppt.transactions WHERE class_id = $1 AND kind = 'reversal' AND root_transaction_id = $2
      `, [target.classId, original.result.transactions[0]])
      const committed = first.code === 'OK' ? first : second
      expect(rows).toEqual([{ transaction_id: committed.result.transactions[0] }])
      const records = await undoRecords(client, target.classId, original.op_id)
      expect(records.map(({ status }) => status).sort()).toEqual(['committed', 'rejected'])
    }
  })

  test('原操作撤銷後可以新編號重做，再撤重做的操作', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const original = await markSubmission(client, target, 'missing')
    const first = await commitOperation(client, undo(target.classId, original.op_id))
    const redone = await commitOperation(client, setStatus(target, 'missing', { after_op: first.op_id }))
    const second = await commitOperation(client, undo(target.classId, redone.op_id))
    expect(second.changes[0]).toMatchObject({ rev: 5, basis_rev: 1, value: { status: 'pending', assignment_active: true } })
    expect(second.result.undo.target_op_id).toBe(redone.op_id)
  })

  test('小野撤銷遇到老師改過基準時，current 只帶操作者種類', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const { classId } = target
    await authorizeAgent(client, classId)
    const mark = setStatus(target, 'missing')
    const { receipts: [original] } = await agentSubmit(client, classId, [mark])
    expect(original.code).toBe('OK')
    const later = await markSubmission(client, target, 'late', 2)
    const { receipts: [receipt] } = await agentSubmit(client, classId, [undo(classId, original.op_id)])
    expect(receipt).toMatchObject({ code: 'UNDO_CONFLICT', status: 'rejected' })
    expect(receipt.current).toEqual({ ...submissionCurrent(later), reason: 'basis_changed', actor: { kind: 'teacher' } })
  })
})
