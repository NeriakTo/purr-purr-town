import { expect } from 'vitest'
import { agentSubmit } from './agent.js'
import { addAgentClass, addManualRule, agentApplyRule } from './agent-fixtures.js'
import { operation } from './schoolwork.js'

export function batchUndo(classId, batchId, count = 1) {
  return operation(classId, 'batch.undo', { batch_id: batchId, expect_op_count: count })
}

export async function ruleBatch(client, count = 1, fixture) {
  fixture ??= await addAgentClass(client, count)
  const { classId, studentIds } = fixture
  const rule = await addManualRule(client, classId)
  const ops = studentIds.slice(0, count).map(studentId => agentApplyRule({ classId, studentId }, rule))
  const batch = await agentSubmit(client, classId, ops)
  expect(batch.receipts.map(receipt => receipt.code)).toEqual(ops.map(() => 'OK'))
  return { ...fixture, rule, ops, batch }
}

export async function batchUndoRows(client, ids) {
  const { rows } = await client.query(`
    SELECT to_jsonb(o) AS value FROM unnest($1::text[]) WITH ORDINALITY AS ids(op_id, position)
    JOIN ppt.operations o USING (op_id)
    ORDER BY ids.position
  `, [ids])
  return rows.map(row => row.value)
}
