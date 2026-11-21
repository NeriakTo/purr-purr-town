import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { addAgentClass, addAgentTask, addManualRule, agentApplyRule } from './test-support/agent-fixtures.js'
import { holdAgentBatch, holdMissingSubmissions } from './test-support/agent-held.js'
import { agentSubmit } from './test-support/agent.js'
import { batchUndo, batchUndoRows, ruleBatch } from './test-support/batch-undo.js'
import { batchUndoId } from './test-support/batch-uuid.js'
import { classSnapshot } from './test-support/checks.js'
import { setEnrollment } from './test-support/correction-rounds.js'
import { adjustment, classSequence, operationCount, submit, teacher } from './test-support/operations.js'
import { commitOperation, restoreTask, saveRule, voidTask } from './test-support/schoolwork.js'
import { markSubmission } from './test-support/submission-flow.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

function undoneItem(outer, target_op_id) {
  return { target_op_id, outcome: 'undone', undo_op_id: batchUndoId(outer.op_id, target_op_id) }
}

function skippedItem(outer, target_op_id, code, attempted = true) {
  return {
    ...undoneItem(outer, target_op_id), outcome: 'skipped', code,
    undo_op_id: attempted ? batchUndoId(outer.op_id, target_op_id) : null,
  }
}

async function expectRejection(client, op, code, current) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code, class_seq: null })
  if (current === undefined) expect(receipt).not.toHaveProperty('current')
  else expect(receipt.current).toEqual(current)
  expect(await classSnapshot(client, op.class_id)).toEqual(before)
  return receipt
}

async function classBalances(client, classId) {
  const { rows } = await client.query(`
    SELECT a.balance::int AS balance FROM ppt.accounts a JOIN ppt.students s USING (class_id, student_id)
    WHERE a.class_id = $1 ORDER BY s.seat_number
  `, [classId])
  return rows.map(row => row.balance)
}

describeDatabase('OP-51 整批撤銷', () => {
  const db = useTestDatabase()

  test('三筆規則按序號倒序撤銷，內部各留收據且外層最後取號', async () => {
    const { client } = db()
    const { classId, studentIds, ops, batch } = await ruleBatch(client, 3)
    await commitOperation(client, { ...adjustment({ classId, studentId: studentIds[0] }, 1), batch_id: batch.call_id })
    const seq = await classSequence(client, classId)
    const op = batchUndo(classId, batch.call_id, 3)
    const outer = await commitOperation(client, op)
    const items = ops.toReversed().map(target => undoneItem(op, target.op_id))
    expect(outer).toMatchObject({ changes: [], warnings: [], class_seq: seq + 4 })
    expect(outer.result).toEqual({
      noop: false, transactions: [], effects_added: [], effects_reversed: [],
      batch: { batch_id: batch.call_id, op_count: 3 }, items,
    })
    const rows = await batchUndoRows(client, items.map(item => item.undo_op_id))
    expect(rows).toHaveLength(3)
    for (const [index, row] of rows.entries()) {
      expect(row).toMatchObject({
        op_id: items[index].undo_op_id, type: 'op.undo',
        actor_kind: 'teacher', actor_id: teacher.id, batch_id: op.op_id,
        payload: { target_op_id: items[index].target_op_id }, status: 'committed',
        class_seq: seq + index + 1, committed_at: outer.committed_at,
        receipt: { class_seq: seq + index + 1, result: { transactions: [expect.any(String)] } },
      })
    }
    expect(await classBalances(client, classId)).toEqual([1, 0, 0])
    const count = await operationCount(client)
    expect(await submit(client, op)).toEqual({ ...outer, replayed: true })
    expect(await operationCount(client)).toBe(count)
    await expectRejection(client, batchUndo(classId, batch.call_id, 1), 'ALREADY_UNDONE')
    await expectRejection(client, undo(classId, ops[0].op_id), 'ALREADY_UNDONE')
    await expectRejection(client, undo(classId, items[0].undo_op_id), 'NOT_UNDOABLE')
  })

  test.each([
    ['少批次', { expect_op_count: 1 }],
    ['空批次', { batch_id: '', expect_op_count: 1 }],
    ['缺筆數', { batch_id: '測試批次' }],
    ['零', { batch_id: '測試批次', expect_op_count: 0 }],
    ['小數', { batch_id: '測試批次', expect_op_count: 1.5 }],
    ['字串', { batch_id: '測試批次', expect_op_count: '1' }],
    ['超過五十', { batch_id: '測試批次', expect_op_count: 51 }],
    ['多餘的鍵', { batch_id: '測試批次', expect_op_count: 1, extra: true }],
    ['帶版本', { batch_id: '測試批次', expect_op_count: 1 }, { rev: 1 }],
    ['帶空版本', { batch_id: '測試批次', expect_op_count: 1 }, null],
  ])('輸入錯誤（%s）優先於查批次', async (_label, payload, expectVersion) => {
    const { client } = db()
    const { classId } = await addAgentClass(client)
    const op = { ...batchUndo(classId, '測試批次'), payload }
    if (expectVersion !== undefined) op.expect = expectVersion
    await expectRejection(client, op, 'INVALID_PAYLOAD')
  })

  test('小野缺少角色資格，封存班的老師不能整批撤銷', async () => {
    const { client } = db()
    const { classId, batch } = await ruleBatch(client)
    const agent = await agentSubmit(client, classId, [batchUndo(classId, batch.call_id)])
    expect(agent.receipts).toMatchObject([{ status: 'rejected', code: 'FORBIDDEN_ROLE' }])
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [classId])
    await expectRejection(client, batchUndo(classId, batch.call_id), 'CLASS_ARCHIVED')
  })

  test('不存在、老師自填、只有舊操作與內部撤銷批次都查不到', async () => {
    const { client } = db()
    const { classId, studentId, batch, ops } = await ruleBatch(client)
    const teacherBatch = randomUUID()
    await commitOperation(client, { ...adjustment({ classId, studentId }), batch_id: teacherBatch })
    const existing = await agentSubmit(client, classId, ops)
    expect(existing.receipts[0].replayed).toBe(true)
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id))
    for (const id of [randomUUID(), teacherBatch, existing.call_id, outer.op_id]) {
      await expectRejection(client, batchUndo(classId, id), 'NOT_FOUND')
    }
  })

  test('筆數比實際多一或少一皆不占用，帶正確筆數照常成立', async () => {
    const { client } = db()
    const { classId, batch } = await ruleBatch(client, 2)
    for (const count of [3, 1]) {
      await expectRejection(client, batchUndo(classId, batch.call_id, count), 'STALE_STATE', { op_count: 2 })
    }
    await commitOperation(client, batchUndo(classId, batch.call_id, 2))
  })

  test('暫緩、退回及全拒絕批次的成立筆數皆為零', async () => {
    const { client } = db()
    const { classId, batch, reject, targets } = await holdMissingSubmissions(client)
    await expectRejection(client, batchUndo(classId, batch.call_id), 'STALE_STATE', { op_count: 0 })
    await commitOperation(client, reject())
    await expectRejection(client, batchUndo(classId, batch.call_id), 'STALE_STATE', { op_count: 0 })
    const rejected = await agentSubmit(client, classId, [setStatus(targets[0], 'missing', { rev: 8 })])
    expect(rejected.receipts[0].status).toBe('rejected')
    await expectRejection(client, batchUndo(classId, rejected.call_id), 'STALE_STATE', { op_count: 0 })
  })

  test('筆數含同值與小野自行撤銷，拒絕成員在已成立成員之後列出', async () => {
    const { client } = db()
    const fixture = await ruleBatch(client)
    const { classId } = fixture
    const [target] = await addAgentTask(client, fixture, -5)
    const ops = [
      setStatus(target, 'missing'), setStatus(target, 'on_time', { rev: 9 }),
      setStatus(target, 'missing', { rev: 2 }), undo(classId, fixture.ops[0].op_id),
      setStatus(target, 'pending', { rev: 9 }),
    ]
    const batch = await agentSubmit(client, classId, ops)
    expect(batch.receipts.map(receipt => receipt.status)).toEqual(['committed', 'rejected', 'committed', 'committed', 'rejected'])
    expect(batch.receipts[2].result.noop).toBe(true)
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id, 3))
    expect(outer.result.items).toEqual([
      skippedItem(outer, ops[3].op_id, 'NOT_UNDOABLE'), undoneItem(outer, ops[2].op_id),
      undoneItem(outer, ops[0].op_id), skippedItem(outer, ops[1].op_id, 'NOT_UNDOABLE', false),
      skippedItem(outer, ops[4].op_id, 'NOT_UNDOABLE', false),
    ])
    expect(await batchUndoRows(client, [batchUndoId(outer.op_id, ops[1].op_id)])).toEqual([])
  })

  test('部分跳過保留拒絕收據和 current，作業恢復後可單獨重撤', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 4)
    const { classId } = fixture
    const targets = await addAgentTask(client, fixture, -5)
    const secondTasks = await addAgentTask(client, fixture)
    targets[1] = secondTasks[1]
    const ops = targets.map(target => setStatus(target, 'missing'))
    const batch = await agentSubmit(client, classId, ops)
    expect(batch.receipts.map(receipt => receipt.code)).toEqual(['OK', 'OK', 'OK', 'OK'])
    await markSubmission(client, targets[0], 'on_time', 2)
    await commitOperation(client, voidTask(classId, targets[1].taskId, false))
    await commitOperation(client, undo(classId, ops[2].op_id))
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id, 4))
    const [changed, inactive, already] = await batchUndoRows(client, ops.slice(0, 3).map(op => batchUndoId(outer.op_id, op.op_id)))
    expect(changed.receipt.current.reason).toBe('basis_changed')
    expect([changed, inactive, already]).toMatchObject([
      { status: 'rejected', code: 'UNDO_CONFLICT', class_seq: null },
      { status: 'rejected', code: 'ENTITY_INACTIVE', class_seq: null },
      { status: 'rejected', code: 'ALREADY_UNDONE', class_seq: null },
    ])
    expect(outer.result.items).toEqual([
      undoneItem(outer, ops[3].op_id), skippedItem(outer, ops[2].op_id, 'ALREADY_UNDONE'),
      skippedItem(outer, ops[1].op_id, 'ENTITY_INACTIVE'),
      { ...skippedItem(outer, ops[0].op_id, 'UNDO_CONFLICT'), current: changed.receipt.current },
    ])
    await commitOperation(client, restoreTask(classId, targets[1].taskId))
    await commitOperation(client, undo(classId, ops[1].op_id))
  })

  test('已單獨沖回仍撤銷成立，將提示合併並附目標編號', async () => {
    const { client } = db()
    const { classId, ops, batch } = await ruleBatch(client, 2)
    const reversed = batch.receipts[0].result.transactions[0]
    await commitOperation(client, reverse(classId, reversed, 5))
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id, 2))
    expect(outer.result.items).toEqual(ops.toReversed().map(op => undoneItem(outer, op.op_id)))
    expect(outer.warnings).toEqual([expect.objectContaining({
      code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'already_reversed', target_op_id: ops[0].op_id,
    })])
  })

  test('03:390 確認後撤掉三筆成立成員，三筆拒絕未建立內部撤銷', async () => {
    const { client } = db()
    const { classId, studentIds } = await addAgentClass(client, 6)
    const ruleA = await addManualRule(client, classId)
    const ruleB = await addManualRule(client, classId)
    const ops = studentIds.map((studentId, index) =>
      agentApplyRule({ classId, studentId }, index === 0 ? ruleA : ruleB))
    const { batch, approve } = await holdAgentBatch(client, classId, ops)
    await commitOperation(client, saveRule(classId, { rule_id: ruleA, amount: 10 }, 1))
    await setEnrollment(client, { classId, studentId: studentIds[1] }, 'transferred')
    await commitOperation(client, agentApplyRule({ classId, studentId: studentIds[2] }, ruleB))
    const approved = await commitOperation(client, approve())
    expect(approved.result.held.items.map(item => item.code)).toEqual([
      'RULE_VERSION_STALE', 'ENTITY_INACTIVE', 'HELD_OP_OUTDATED', 'OK', 'OK', 'OK',
    ])
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id, 3))
    expect(outer.result.items).toEqual([
      ...ops.slice(3).toReversed().map(op => undoneItem(outer, op.op_id)),
      ...ops.slice(0, 3).map(op => skippedItem(outer, op.op_id, 'NOT_UNDOABLE', false)),
    ])
    expect(await classBalances(client, classId)).toEqual([0, 0, 5, 0, 0, 0])
  })

  test('十次雙連線競爭，每批只成立一次且每個成員只撤一次', async () => {
    const { client, connect } = db()
    const other = await connect()
    const { rows: indexes } = await client.query(`
      SELECT indisunique, indisvalid, pg_get_indexdef(indexrelid) AS definition
      FROM pg_index WHERE indexrelid = to_regclass('ppt.operations_one_committed_batch_undo')
    `)
    expect(indexes).toMatchObject([{
      indisunique: true, indisvalid: true,
      definition: expect.stringMatching(/\bclass_id\b.*batch_id.*WHERE.*batch\.undo.*committed/),
    }])
    for (let i = 0; i < 10; i += 1) {
      const { classId, ops, batch } = await ruleBatch(client, 2)
      const results = await Promise.all([
        submit(client, batchUndo(classId, batch.call_id, 2)),
        submit(other, batchUndo(classId, batch.call_id, 2)),
      ])
      expect(results.map(receipt => receipt.code).sort()).toEqual(['ALREADY_UNDONE', 'OK'])
      const { rows } = await client.query(`
        SELECT payload->>'target_op_id' AS target_id FROM ppt.operations
        WHERE class_id = $1 AND type = 'op.undo' AND status = 'committed' ORDER BY target_id
      `, [classId])
      expect(rows.map(row => row.target_id)).toEqual(ops.map(op => op.op_id).sort())
    }
  })
})
