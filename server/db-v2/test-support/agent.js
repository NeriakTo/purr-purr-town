import { randomUUID } from 'node:crypto'

export async function authorizeAgent(client, classId) {
  await client.query(
    "INSERT INTO ppt.class_authorizations (class_id, actor_kind) VALUES ($1, 'agent')", [classId],
  )
}

export async function agentSubmit(client, classId, ops, callId = randomUUID()) {
  const { rows: [{ receipt }] } = await client.query(
    'SELECT ppt.agent_submit($1, $2, $3::jsonb, $4) AS receipt',
    [classId, callId, JSON.stringify(ops), null],
  )
  return receipt
}
