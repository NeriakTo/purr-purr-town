import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { hashSessionToken } from '../auth/session.js'

export { addClass as createTestClass } from '../../db-v2/test-support/operations.js'

export function createTestTeacher() {
  return { kind: 'teacher', id: randomUUID() }
}

export async function createLegacyTeacher(client, { name, passcode }) {
  const { default: bcrypt } = await import('bcrypt')
  const suffix = randomInt(36 ** 4).toString(36).padStart(4, '0')
  const id = `t_${Date.now().toString(36)}_${suffix}`
  const hash = await bcrypt.hash(passcode, 4)
  await client.query(
    'INSERT INTO public.teachers (id, name, passcode_hash) VALUES ($1, $2, $3)', [id, name, hash],
  )
  return { id, name, passcode }
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
