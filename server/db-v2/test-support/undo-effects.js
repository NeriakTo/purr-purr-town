import { randomUUID } from 'node:crypto'
import { adjustment } from './operations.js'
import { commitOperation } from './schoolwork.js'
import { markSubmission } from './submission-flow.js'
import { lateEvent, setupSubmissionUndo } from './undo-submissions.js'

export async function setupEffectConflict(client) {
  const { target, lateRule } = await setupSubmissionUndo(client)
  const { classId, studentId, taskId } = target
  await markSubmission(client, target, 'late')
  const missing = await markSubmission(client, target, 'missing', 2)
  const source = await commitOperation(client, adjustment(target, 1))
  const { rows: [entry] } = await client.query(`
    SELECT (ppt.append_account_transaction(
      $1, $2, $3, 'rule_auto', -6, -6, $4, $4, '測試扣分', NULL, $5, 1
    )).transaction_id AS id
  `, [classId, studentId, source.op_id, source.committed_at, lateRule.rule_id])

  const effectId = randomUUID()
  await client.query(`
    INSERT INTO ppt.effects (class_id, student_id, effect_id, lineage_id, event, subject_kind, subject_key,
      rule_id, rule_rev, root_transaction_id, status, origin, created_op_id)
    VALUES ($1, $2, $3, $3, $4, 'task', $5, $6, 1, $7, 'active', 'op', $8)
  `, [classId, studentId, effectId, lateEvent, taskId, lateRule.rule_id, entry.id, source.op_id])
  return { target, missing, effectId }
}
