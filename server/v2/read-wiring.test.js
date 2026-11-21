import { expect, it } from 'vitest'
import { holdAgentBatch } from '../db-v2/test-support/agent-held.js'
import { addAgentClass, addAgentTask } from '../db-v2/test-support/agent-fixtures.js'
import { saveAnnouncement, saveSeating } from '../db-v2/test-support/announcement-seating.js'
import { batchUndo, batchUndoRows, ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { createClass } from '../db-v2/test-support/class-create.js'
import { saveGroup, updateStudentProfile } from '../db-v2/test-support/class-student-group.js'
import { saveComment } from '../db-v2/test-support/comments.js'
import { propose } from '../db-v2/test-support/confirmations.js'
import { requireRound } from '../db-v2/test-support/correction-rounds.js'
import { importedFixture, readEffect, resolveLegacyEffect } from '../db-v2/test-support/legacy-effects.js'
import { addClass, adjustment, classSequence } from '../db-v2/test-support/operations.js'
import { payrollDay, saveJob, setDuty } from '../db-v2/test-support/payroll.js'
import { saveProduct } from '../db-v2/test-support/products.js'
import { commitOperation, createTask, saveRule } from '../db-v2/test-support/schoolwork.js'
import { currency, setSetting } from '../db-v2/test-support/settings.js'
import { purchase } from '../db-v2/test-support/shop.js'
import { assignTask, saveEventRule } from '../db-v2/test-support/submission-flow.js'
import { setStatus } from '../db-v2/test-support/submissions.js'
import { describeDatabase, useTestDatabase } from '../db-v2/test-support/suite.js'

async function buyItem(client, target) {
  const product = saveProduct(target.classId)
  await commitOperation(client, product)
  await commitOperation(client, adjustment(target, 10))
  return purchase({ ...target, productId: product.payload.product_id })
}

const entities = [
  ['class', 'classes', () => createClass()],
  ['student', 'students', (_, target) => updateStudentProfile(target, { name: '1號村民（測試）' })],
  ['account', 'accounts', (_, target) => adjustment(target)],
  ['submission', 'submissions', async (client, target) => setStatus(await assignTask(client, target), 'on_time')],
  ['task', 'tasks', (_, target) => createTask(target.classId)],
  ['rule', 'rules', (_, target) => saveRule(target.classId)],
  ['confirmation', 'confirmations', async (client, target) => propose(await assignTask(client, target), 'missing')],
  ['correction', 'corrections', async (client, target) => requireRound(await assignTask(client, target))],
  ['product', 'products', (_, target) => saveProduct(target.classId)],
  ['inventory_item', 'inventory_items', buyItem],
  ['setting', 'settings_entries', (_, target) => setSetting(target.classId, 'currency', currency())],
  ['job', 'jobs', (_, target) => saveJob(target.classId)],
  ['duty', 'daily_duties', (_, target) => setDuty(target.classId, payrollDay, [target.studentId])],
  ['group', 'groups', (_, target) => saveGroup(target.classId)],
  ['announcement', 'announcements', (_, target) => saveAnnouncement(target.classId)],
  ['seating', 'seating', (_, target) => saveSeating(target.classId)],
  ['comment', 'comments', (_, target) => saveComment(target)],
]

async function assertVersionLink(client, table, classId, receipt) {
  const { rows } = await client.query(`
    SELECT entity.last_op_id, operation.class_seq::int
    FROM ppt.${table} AS entity
    JOIN ppt.operations AS operation
      ON operation.class_id = entity.class_id AND operation.op_id = entity.last_op_id
    WHERE entity.class_id = $1 AND entity.last_op_id = $2
  `, [classId, receipt.op_id])
  expect(rows).toEqual([{ last_op_id: receipt.op_id, class_seq: receipt.class_seq }])
}

describeDatabase('增量讀取的接線', () => {
  const database = useTestDatabase()

  it.each(entities)('%s 的最後操作接到收據與班級序號', async (_, table, makeOperation) => {
    const { client } = database()
    const op = await makeOperation(client, await addClass(client))
    const receipt = await commitOperation(client, op)
    expect(receipt.class_seq).toBe(await classSequence(client, op.class_id))
    await assertVersionLink(client, table, op.class_id, receipt)
  })

  it('小野暫緩的待確認項目連到空序號，班級序號維持原值', async () => {
    const { client } = database()
    const fixture = await addAgentClass(client, 6)
    const targets = await addAgentTask(client, fixture, -5)
    const ops = targets.map(target => setStatus(target, 'missing'))
    const before = await classSequence(client, fixture.classId)
    await holdAgentBatch(client, fixture.classId, ops)
    expect(await classSequence(client, fixture.classId)).toBe(before)
    const { rows } = await client.query(`
      SELECT c.last_op_id, o.class_seq, o.status
      FROM ppt.confirmations c JOIN ppt.operations o
        ON o.class_id = c.class_id AND o.op_id = c.last_op_id
      WHERE c.class_id = $1 AND c.confirmation_id = $2
    `, [fixture.classId, ops[0].op_id])
    expect(rows).toEqual([{ last_op_id: ops[0].op_id, class_seq: null, status: 'held' }])
  })

  it('OP-53 裁決更新效果狀態，序號經繳交列取得', async () => {
    const { client } = database()
    const target = await importedFixture(client)
    const before = await readEffect(client, target)
    const receipt = await commitOperation(client, resolveLegacyEffect(target, 'none'))
    expect(before.status).toBe('legacy_unresolved')
    const after = await readEffect(client, target)
    expect(after).toEqual({ ...before, status: 'dismissed' })
    expect(after).not.toHaveProperty('last_op_id')
    expect(Object.values(after)).not.toContain(receipt.op_id)
    expect(receipt.class_seq).toBe(await classSequence(client, target.classId))
    await assertVersionLink(client, 'submissions', target.classId, receipt)
  })

  it('OP-51 回復的帳戶連到內部撤銷序號', async () => {
    const { client } = database()
    const { classId, batch } = await ruleBatch(client)
    const outer = await commitOperation(client, batchUndo(classId, batch.call_id))
    const [{ undo_op_id: undoId }] = outer.result.items
    const [inner] = await batchUndoRows(client, [undoId])
    expect(inner.class_seq).toBeGreaterThan(0)
    expect(inner.class_seq).toBeLessThan(outer.class_seq)
    expect(outer.class_seq).toBe(await classSequence(client, classId))
    await assertVersionLink(client, 'accounts', classId, inner.receipt)
  })

  it('存摺交易的 op_id 接到成立序號', async () => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await commitOperation(client, adjustment(target))
    const { rows } = await client.query(`
      SELECT t.op_id, o.class_seq::int
      FROM ppt.transactions t JOIN ppt.operations o USING (class_id, op_id)
      WHERE t.class_id = $1
    `, [target.classId])
    expect(rows).toEqual([{ op_id: receipt.op_id, class_seq: receipt.class_seq }])
  })

  it('效果建立與沖回各自接到成立序號', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    await saveEventRule(client, target.classId, 'submission.missing', -5)
    const created = await commitOperation(client, setStatus(target, 'missing'))
    const reversed = await commitOperation(client, setStatus(target, 'on_time', { after_op: created.op_id }))
    const { rows } = await client.query(`
      SELECT e.created_op_id, e.reversed_op_id, created.class_seq::int AS created_seq,
        reversed.class_seq::int AS reversed_seq
      FROM ppt.effects e
      JOIN ppt.operations created ON created.class_id = e.class_id AND created.op_id = e.created_op_id
      JOIN ppt.operations reversed ON reversed.class_id = e.class_id AND reversed.op_id = e.reversed_op_id
      WHERE e.class_id = $1
    `, [target.classId])
    expect(rows).toEqual([{
      created_op_id: created.op_id, reversed_op_id: reversed.op_id,
      created_seq: created.class_seq, reversed_seq: reversed.class_seq,
    }])
  })
})
