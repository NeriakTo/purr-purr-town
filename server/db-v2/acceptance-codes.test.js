import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { addAgentClass, addManualRule, agentApplyRule } from './test-support/agent-fixtures.js'
import { heldMemberRows, holdAgentBatch, holdMissingSubmissions } from './test-support/agent-held.js'
import { classSnapshot } from './test-support/checks.js'
import { lockComment, requestComment } from './test-support/comments.js'
import { submissionData } from './test-support/confirmations.js'
import { addImportedEffect } from './test-support/legacy-effects.js'
import { addClass, adjustment, classSequence, operationCount, submit } from './test-support/operations.js'
import { readResultCodes } from './test-support/operation-specification.js'
import { commitOperation, saveRule } from './test-support/schoolwork.js'
import { addProduct, purchase } from './test-support/shop.js'
import { addSubmission, addTask, setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function rejectionTarget(client) {
  const fixture = await addClass(client)
  const { classId } = fixture
  const target = { ...fixture, taskId: await addTask(client, classId), productId: await addProduct(client, classId) }
  await addSubmission(client, target)
  await authorizeAgent(client, classId)
  return target
}

async function assertFinalRejection(client, op, code, send) {
  const { class_id: classId, op_id: opId } = op
  const before = await classSnapshot(client, classId)
  const seq = await classSequence(client, classId)
  const count = await operationCount(client)

  const receipt = await send()
  expect(receipt).toMatchObject({ op_id: opId, status: 'rejected', code, replayed: false, class_seq: null })
  const { rows } = await client.query(`
    SELECT code, status, payload, expect, receipt FROM ppt.operations WHERE class_id = $1 AND op_id = $2
  `, [classId, opId])
  expect(rows).toEqual([{ code, status: 'rejected', payload: op.payload, expect: op.expect ?? null, receipt }])
  expect(await classSnapshot(client, classId)).toBe(before)
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, classId)).toBe(seq)

  expect(await send()).toEqual({ ...receipt, replayed: true })
  expect(await classSnapshot(client, classId)).toBe(before)
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, classId)).toBe(seq)
}

async function duplicateItemPurchase(client, target) {
  expect((await submit(client, adjustment(target, 5))).code).toBe('OK')
  const original = purchase(target)
  expect((await submit(client, original)).code).toBe('OK')
  const duplicate = purchase(target, 100)
  duplicate.payload.item_id = original.payload.item_id
  return duplicate
}

const cases = [
  ['UNKNOWN_OP_TYPE', (_client, target) => ({ ...adjustment(target), type: 'unknown.operation' })],
  ['INVALID_PAYLOAD', (_client, target) => adjustment(target, 0)],
  ['FORBIDDEN_ROLE', (_client, target) => purchase(target), true],
  ['SCOPE_FORBIDDEN', (_client, target) => setStatus({ ...target, taskId: randomUUID() }, 'missing'), true],
  ['NOT_FOUND', (_client, target) => purchase({ ...target, productId: randomUUID() })],
  ['ID_CONFLICT', duplicateItemPurchase],
  ['STALE_STATE', (_client, target) => setStatus(target, 'missing', { rev: 8 })],
  ['ENTITY_INACTIVE', async (client, target) => {
    await client.query('UPDATE ppt.products SET disabled = true WHERE class_id = $1', [target.classId])
    return purchase(target)
  }],
  ['CLASS_ARCHIVED', async (client, target) => {
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [target.classId])
    return adjustment(target)
  }],
  ['INSUFFICIENT_BALANCE', (_client, target) => purchase(target)],
  ['OUT_OF_STOCK', async (client, target) => {
    await client.query('UPDATE ppt.products SET stock = 0 WHERE class_id = $1', [target.classId])
    return purchase(target)
  }],
  ['PRICE_CHANGED', (_client, target) => purchase(target, 10)],
  ['INVALID_TRANSITION', async (client, { classId }) => {
    const taskId = randomUUID()
    const created = await submit(client, {
      op_id: randomUUID(), class_id: classId, type: 'task.create',
      payload: {
        task_id: taskId, title: '測試作業', task_type: '作業', published_on: '2026-11-21', due_on: '2026-11-22',
      },
    })
    expect(created.code).toBe('OK')
    return {
      op_id: randomUUID(), class_id: classId, type: 'task.restore',
      payload: { task_id: taskId }, expect: { rev: 1 },
    }
  }],
  ['CONFIRMATION_NOT_PENDING', async (client, { classId, studentId }) => {
    const taskId = randomUUID()
    const created = await submit(client, {
      op_id: randomUUID(), class_id: classId, type: 'task.create',
      payload: {
        task_id: taskId, title: '測試作業', task_type: '作業', published_on: '2026-11-21', due_on: '2026-11-22',
      },
    })
    expect(created.code).toBe('OK')
    const proposal = await submit(client, {
      op_id: randomUUID(), class_id: classId, type: 'submission.propose',
      payload: { task_id: taskId, student_id: studentId, proposed_status: 'missing' },
    })
    expect(proposal.code).toBe('OK')
    const confirm = {
      op_id: randomUUID(), class_id: classId, type: 'confirmation.confirm',
      payload: { confirmation_id: proposal.op_id },
    }
    expect((await submit(client, confirm)).code).toBe('OK')
    return { ...confirm, op_id: randomUUID() }
  }],
  ['RULE_VERSION_STALE', async (client, target) => {
    const ruleId = randomUUID()
    const save = {
      ...adjustment(target), type: 'rule.save', expect: { rev: 0 },
      payload: { rule_id: ruleId, kind: 'manual', name: '驗收規則', amount: 10 },
    }
    expect((await submit(client, save)).code).toBe('OK')
    expect((await submit(client, { ...save, op_id: randomUUID(), expect: { rev: 1 },
      payload: { ...save.payload, amount: 5 } })).code).toBe('OK')
    return { ...adjustment(target), type: 'points.apply_rule',
      payload: { student_id: target.studentId, rule_id: ruleId, rule_version: 1 } }
  }],
  ['TX_NOT_REVERSIBLE', async (client, target) => {
    expect((await submit(client, adjustment(target, 10))).code).toBe('OK')
    const bought = await submit(client, purchase(target))
    expect(bought.code).toBe('OK')
    return { ...adjustment(target), type: 'tx.reverse',
      payload: { transaction_id: bought.result.transactions[0], expect_effective_amount: -3 } }
  }],
  ['TX_ALREADY_REVERSED', async (client, target) => {
    const root = await submit(client, adjustment(target, 10))
    expect(root.code).toBe('OK')
    const payload = { transaction_id: root.result.transactions[0], expect_effective_amount: 10 }
    expect((await submit(client, { ...adjustment(target), type: 'tx.reverse', payload })).code).toBe('OK')
    return { ...adjustment(target), type: 'tx.correct', payload: { ...payload, new_amount: 5 } }
  }],
  ['ITEM_ALREADY_USED', async (client, target) => {
    expect((await submit(client, adjustment(target, 10))).code).toBe('OK')
    const buy = purchase(target)
    expect((await submit(client, buy)).code).toBe('OK')
    const use = { ...adjustment(target), type: 'inventory.use', payload: { item_id: buy.payload.item_id } }
    expect((await submit(client, use)).code).toBe('OK')
    return { ...use, op_id: randomUUID() }
  }],
  ['NOT_UNDOABLE', async (client, target) => {
    const adjusted = await submit(client, adjustment(target, 10))
    expect(adjusted.code).toBe('OK')
    const reversed = await submit(client, {
      ...adjustment(target), type: 'tx.reverse',
      payload: { transaction_id: adjusted.result.transactions[0], expect_effective_amount: 10 },
    })
    expect(reversed.code).toBe('OK')
    return { ...adjustment(target), type: 'op.undo', payload: { target_op_id: reversed.op_id } }
  }],
  ['ALREADY_UNDONE', async (client, target) => {
    const original = await submit(client, adjustment(target, 10))
    expect(original.code).toBe('OK')
    const undone = { ...adjustment(target), type: 'op.undo', payload: { target_op_id: original.op_id } }
    expect((await submit(client, undone)).code).toBe('OK')
    return { ...undone, op_id: randomUUID() }
  }],
  ['UNDO_CONFLICT', async (client, target) => {
    const taskId = randomUUID()
    const created = await submit(client, {
      ...adjustment(target), type: 'task.create',
      payload: {
        task_id: taskId, title: '測試作業', task_type: '作業', published_on: '2026-11-21', due_on: '2026-11-22',
      },
    })
    expect(created.code).toBe('OK')
    const assigned = { ...target, taskId }
    const missing = await submit(client, setStatus(assigned, 'missing'))
    expect(missing.code).toBe('OK')
    expect((await submit(client, setStatus(assigned, 'on_time', { rev: 2 }))).code).toBe('OK')
    return { ...adjustment(target), type: 'op.undo', payload: { target_op_id: missing.op_id } }
  }],
  ['LEGACY_EFFECT_UNRESOLVED', async (client, target) => {
    await client.query(`
      UPDATE ppt.submissions SET status = 'missing', legacy_status_at_import = 'missing'
      WHERE class_id = $1 AND task_id = $2 AND student_id = $3
    `, [target.classId, target.taskId, target.studentId])
    await addImportedEffect(client, target)
    return setStatus(target, 'on_time')
  }],
  ['COMMENT_LOCKED', async (client, target) => {
    await commitOperation(client, lockComment(target))
    return requestComment(target, { rev: 1 })
  }],
]

describeDatabase('錯誤碼逐碼驗收', () => {
  const db = useTestDatabase()

  test.each(cases)('%s 只留一列拒絕，快照與序號不變且重播原收據', async (code, makeOperation, asAgent) => {
    const { client } = db()
    const target = await rejectionTarget(client)
    const op = await makeOperation(client, target)
    const callId = randomUUID()
    async function send() {
      if (!asAgent) return submit(client, op)
      const batch = await agentSubmit(client, target.classId, [op], callId)
      return batch.receipts[0]
    }
    await assertFinalRejection(client, op, code, send)
  })

  test('小野的 call_id 或任一 op_id 用 v5 時整批不登記', async () => {
    const { client } = db()
    const target = await rejectionTarget(client)
    const { classId } = target
    const v5 = '00000000-0000-5000-8000-000000000001'
    const op = setStatus(target, 'missing')
    const snapshot = await classSnapshot(client, classId)
    const count = await operationCount(client)
    const callId = randomUUID()
    expect(await agentSubmit(client, classId, [op], v5))
      .toEqual({ call_id: v5, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await agentSubmit(client, classId, [op, { ...op, op_id: v5 }], callId))
      .toEqual({ call_id: callId, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await agentSubmit(client, classId, [op, { ...op, op_id: undefined }], callId))
      .toEqual({ call_id: callId, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await classSnapshot(client, classId)).toBe(snapshot)
    expect(await operationCount(client)).toBe(count)
    expect(await classSequence(client, classId)).toBe(0)
  })
})

async function assertHeldFinalRejection(client, classId, ops, held, process, code) {
  const before = await submissionData(client, classId)
  const count = await operationCount(client)
  const seq = await classSequence(client, classId)
  await commitOperation(client, process)
  const members = await heldMemberRows(client, ops)
  expect(members).toEqual(ops.map(op => expect.objectContaining({
    op_id: op.op_id, status: 'rejected', code, class_seq: null, committed_at: null,
    receipt: expect.objectContaining({
      op_id: op.op_id, status: 'rejected', code, class_seq: null, committed_at: null,
      changes: [], warnings: [], result: { noop: false, transactions: [], effects_added: [], effects_reversed: [] },
    }),
  })))
  for (const row of members) expect(row.receipt).not.toHaveProperty('current')
  expect(await submissionData(client, classId)).toEqual(before)
  expect(await classSequence(client, classId)).toBe(seq + 1)
  expect(await operationCount(client)).toBe(count + 1)
  expect(await agentSubmit(client, classId, ops, held.call_id)).toEqual({
    call_id: held.call_id,
    receipts: members.map(({ receipt }) => ({ ...receipt, replayed: true })),
  })
  expect(await submissionData(client, classId)).toEqual(before)
  expect(await operationCount(client)).toBe(count + 1)
}

describeDatabase('03:374 小野暫緩後定案的錯誤碼', () => {
  const db = useTestDatabase()

  test('CONFIRMATION_REJECTED 存入原列，沒有交易或效果，重播同一收據', async () => {
    const { client } = db()
    const { classId, ops, batch, reject } = await holdMissingSubmissions(client)
    await assertHeldFinalRejection(client, classId, ops, batch, reject(), 'CONFIRMATION_REJECTED')
  })

  test('HELD_OP_OUTDATED 優先於版本不符，存入原列且重播同一收據', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const ruleId = await addManualRule(client, classId, 201)
    const ops = [agentApplyRule(fixture, ruleId)]
    const { batch, approve } = await holdAgentBatch(client, classId, ops)
    await commitOperation(client, saveRule(classId, { rule_id: ruleId, amount: 5 }, 1))
    await commitOperation(client, agentApplyRule(fixture, ruleId, 2))
    await assertHeldFinalRejection(client, classId, ops, batch, approve(), 'HELD_OP_OUTDATED')
  })
})

test('03:374 的驗收逐項涵蓋規格的二十五個定案拒絕碼', async () => {
  const [{ final }, source] = await Promise.all([
    readResultCodes(), readFile(new URL(import.meta.url), 'utf8'),
  ])
  expect(final).toHaveLength(28)
  const nonRejections = new Set(['OK', 'HELD_FOR_TEACHER', 'OP_CANCELLED'])
  const codes = final.filter(({ code }) => !nonRejections.has(code)).map(({ code }) => code)
  expect(codes).toHaveLength(25)
  const held = [...source.matchAll(/^ {2}test\('((?:CONFIRMATION_REJECTED|HELD_OP_OUTDATED)) /gm)]
    .map(([, code]) => code)
  expect([...cases.map(([code]) => code), ...held].sort()).toEqual(codes.sort())
})
