import { createHash } from 'node:crypto'
import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'

const relayLifetimeMs = 24 * 60 * 60 * 1000
export const sessionLifetimeMs = 90 * relayLifetimeMs

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function readBearer(authorization) {
  if (typeof authorization !== 'string' || authorization.length !== 71) return undefined
  return /^Bearer ([0-9a-f]{64})$/.exec(authorization)?.[1]
}

export function sessionExpiresAt(session) {
  const expiresAt = session.expires_at.getTime()
  if (session.first_relayed_at === null) return expiresAt
  return Math.min(expiresAt, session.first_relayed_at.getTime() + relayLifetimeMs)
}

export async function requireTeacher(pool, authorization, clock) {
  const token = readBearer(authorization)
  if (!token) throw new RequestError('AUTH_REQUIRED')

  const { rows: [session] } = await readQuery(pool, `
    SELECT teacher_id, expires_at, first_relayed_at
    FROM ppt_web_state.sessions WHERE token_hash = $1
  `, [hashSessionToken(token)])

  if (!session) throw new RequestError('AUTH_REQUIRED')
  if (clock().getTime() >= sessionExpiresAt(session)) throw new RequestError('AUTH_EXPIRED')
  return { kind: 'teacher', id: session.teacher_id }
}
