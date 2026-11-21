import { agentSubmit, authorizeAgent } from '../../db-v2/test-support/agent.js'
import { createClass } from '../../db-v2/test-support/class-create.js'
import { addImportedEffect, addImportedSubmission, addImportedTask } from '../../db-v2/test-support/legacy-effects.js'
import { adjustment } from '../../db-v2/test-support/operations.js'
import { commitReadOperation } from './read-entities.js'

export function insertReadTransactions(client, { classId, studentId, studentIds = [studentId] }, count) {
  return client.query(`
    INSERT INTO ppt.transactions (class_id, student_id, transaction_id, kind, amount, earned_delta,
      occurred_at, effective_at, reason, origin, batch_id)
    SELECT $1, ($2::text[])[1 + (number - 1) % cardinality($2::text[])],
      '測試匯入-' || lpad(number::text, 5, '0'), 'legacy_general', -1.5, -1.5,
      TIMESTAMPTZ '2026-11-01T00:00:00Z' + ((number - 1) / 2) * interval '1 microsecond',
      TIMESTAMPTZ '2026-11-01T00:00:00Z', '測試匯入交易', 'migration', '測試匯入批次'
    FROM generate_series(1, $3) AS number
  `, [classId, studentIds, count])
}

export async function prepareReadScale({ client, teacher }) {
  const creation = createClass(30)
  await commitReadOperation(client, creation, teacher)
  const studentIds = creation.payload.student_ids
  const target = { classId: creation.class_id, studentId: studentIds[0], studentIds }
  await insertReadTransactions(client, target, 1200)
  const taskId = await addImportedTask(client, target.classId)
  await addImportedSubmission(client, { ...target, taskId }, 'missing')
  await addImportedEffect(client, { ...target, taskId })
  await authorizeAgent(client, target.classId)
  const batch = await agentSubmit(client, target.classId, [adjustment(target)], undefined, '測試量測批次')
  await client.query('UPDATE ppt.agent_calls SET created_at = $2 WHERE call_id = $1', [batch.call_id, '2026-11-22T07:00:00Z'])
  return target
}

export async function measureReadRequest(label, request) {
  const start = performance.now()
  const response = await request()
  const elapsed = performance.now() - start
  console.info(`T-607 ${label}，${response.rawPayload.length} 位元組，${elapsed.toFixed(1)} 毫秒`)
  return response
}
