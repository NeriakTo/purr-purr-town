import { randomBytes } from 'node:crypto'
import { addClass } from './operations.js'
import { operation } from './schoolwork.js'
import { addLegacyTransaction } from './transactions.js'

export async function addImportedTask(client, classId) {
  const taskId = randomBytes(32).toString('hex')
  await client.query(`
    INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester)
    VALUES ($1, $2, '匯入作業', '作業', '2026-09-01', '2026-09-02', '115-1')
  `, [classId, taskId])
  return taskId
}

export async function addImportedSubmission(client, { classId, taskId, studentId }, status) {
  await client.query(`
    INSERT INTO ppt.submissions (class_id, task_id, student_id, status, legacy_status_at_import)
    VALUES ($1, $2, $3, $4, $4)
  `, [classId, taskId, studentId, status])
}

export async function addImportedEffect(client, { classId, taskId, studentId }, {
  status = 'legacy_unresolved', event = null, root = null, suggested = null,
} = {}) {
  const effectId = randomBytes(32).toString('hex')
  await client.query(`
    INSERT INTO ppt.effects (class_id, effect_id, student_id, subject_kind, subject_key, status, origin,
      event, root_transaction_id, suggested_transaction_id, lineage_id)
    VALUES ($1, $2, $3, 'task', $4, $5, 'legacy', $6, $7, $8, $2)
  `, [classId, effectId, studentId, taskId, status, event, root, suggested])
  return effectId
}

export function addImportedDeduction(client, target, {
  amount = -6, reason = '作業缺交', occurredAt = '2026-09-10T12:00:00+08:00',
  effectiveAt = occurredAt, ...fields
} = {}) {
  return addLegacyTransaction(client, target, { amount, reason, occurredAt, effectiveAt, ...fields })
}

export async function importedFixture(client, {
  status = 'missing', linked = false, suggested = false, dismissed = false,
  event = status === 'late' ? 'submission.late' : 'submission.missing', students, amount,
} = {}) {
  const target = await addClass(client, { students })
  target.taskId = await addImportedTask(client, target.classId)
  await addImportedSubmission(client, target, status)
  const reason = event === 'submission.late' ? '作業遲交' : '作業缺交'
  if (linked || suggested) target.transactionId = await addImportedDeduction(client, target, { amount, reason })
  target.effectId = await addImportedEffect(client, target, {
    status: linked ? 'active' : dismissed ? 'dismissed' : 'legacy_unresolved',
    event: linked ? event : null,
    root: linked ? target.transactionId : null,
    suggested: suggested ? target.transactionId : null,
  })
  return target
}

export async function readEffect(client, { classId, effectId }) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.effects WHERE class_id = $1 AND effect_id = $2', [classId, effectId],
  )
  return row
}

export async function importedDeduction(client, { classId, studentId }) {
  const { rows: [row] } = await client.query(`
    SELECT balance::int, (SELECT count(*)::int FROM ppt.transactions
      WHERE class_id = a.class_id AND student_id = a.student_id) AS count
    FROM ppt.accounts a WHERE class_id = $1 AND student_id = $2
  `, [classId, studentId])
  return row
}

export function resolveLegacyEffect(target, resolution, fields = {}, expect = { rev: 1 }) {
  return operation(target.classId, 'legacy_effect.resolve', {
    effect_id: target.effectId, resolution, ...fields,
  }, expect)
}
