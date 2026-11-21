import { randomBytes, randomUUID } from 'node:crypto'
import { hashSessionToken } from '../auth/session.js'

export { addClass as createTestClass } from '../../db-v2/test-support/operations.js'

export function createTestTeacher() {
  return { kind: 'teacher', id: randomUUID() }
}

export async function createTestSession(client, teacherId, {
  expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000),
  firstRelayedAt = null,
} = {}) {
  const token = randomBytes(32).toString('hex')
  await client.query(`
    INSERT INTO ppt_web_state.sessions (token_hash, teacher_id, expires_at, first_relayed_at)
    VALUES ($1, $2, $3, $4)
  `, [hashSessionToken(token), teacherId, expiresAt, firstRelayedAt])
  return token
}
