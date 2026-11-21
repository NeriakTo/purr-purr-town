import { expect } from 'vitest'
import { agentSubmit } from './agent.js'
import { addAgentClass, addAgentTask } from './agent-fixtures.js'
import { confirm } from './confirmations.js'
import { setStatus } from './submissions.js'

export async function holdAgentBatch(client, classId, ops, newOps = ops) {
  const batch = await agentSubmit(client, classId, ops)
  const confirmationId = newOps[0].op_id
  const newIds = new Set(newOps.map(op => op.op_id))
  for (const receipt of batch.receipts.filter(item => newIds.has(item.op_id))) {
    expect(receipt).toMatchObject({
      status: 'held', code: 'HELD_FOR_TEACHER', result: { confirmation_id: confirmationId },
    })
  }
  return {
    batch,
    approve: () => confirm(classId, confirmationId),
    reject: () => confirm(classId, confirmationId, 'confirmation.reject'),
  }
}

export async function holdMissingSubmissions(client, studentCount = 6) {
  const fixture = await addAgentClass(client, studentCount)
  const targets = await addAgentTask(client, fixture, -5)
  const ops = targets.slice(0, 6).map(target => setStatus(target, 'missing'))
  const held = await holdAgentBatch(client, fixture.classId, ops)
  return { ...fixture, ...held, targets, ops }
}

export async function heldMemberRows(client, ops) {
  const { rows } = await client.query(`
    SELECT to_jsonb(o) AS value FROM unnest($1::text[]) WITH ORDINALITY AS ids(op_id, position)
    JOIN ppt.operations o USING (op_id)
    ORDER BY ids.position
  `, [ops.map(op => op.op_id)])
  return rows.map(row => row.value)
}
