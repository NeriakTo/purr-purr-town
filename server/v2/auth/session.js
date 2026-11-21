import { createHash } from 'node:crypto'
import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'

const relayLifetimeMs = 24 * 60 * 60 * 1000
export const sessionLifetimeMs = 90 * relayLifetimeMs
const slideThresholdMs = 30 * relayLifetimeMs

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

function requireTokenHash(authorization) {
  const token = readBearer(authorization)
  if (!token) throw new RequestError('AUTH_REQUIRED')
  return hashSessionToken(token)
}

async function readSession(pool, tokenHash) {
  const { rows: [session] } = await readQuery(pool, `
    SELECT teacher_id, expires_at, first_relayed_at
    FROM ppt_web_state.sessions WHERE token_hash = $1
  `, [tokenHash])
  return session
}

async function markSessionRelayed(pool, tokenHash, now) {
  const { rows: [session] } = await readQuery(pool, `
    UPDATE ppt_web_state.sessions SET first_relayed_at = COALESCE(first_relayed_at, $2)
    WHERE token_hash = $1
    RETURNING teacher_id, expires_at, first_relayed_at
  `, [tokenHash, now])
  return session
}

async function extendDirectSession(pool, tokenHash, now) {
  const time = now.getTime()
  const { rows: [session] } = await readQuery(pool, `
    UPDATE ppt_web_state.sessions SET expires_at = $4
    WHERE token_hash = $1 AND first_relayed_at IS NULL AND expires_at > $2 AND expires_at < $3
    RETURNING teacher_id, expires_at, first_relayed_at
  `, [tokenHash, now, new Date(time + slideThresholdMs), new Date(time + sessionLifetimeMs)])
  return session ?? readSession(pool, tokenHash)
}

function requireActiveSession(session, clock) {
  if (!session) throw new RequestError('AUTH_REQUIRED')
  const expiresAt = sessionExpiresAt(session)
  if (clock().getTime() >= expiresAt) throw new RequestError('AUTH_EXPIRED')
  return expiresAt
}

function sessionActor(session) {
  return { kind: 'teacher', id: session.teacher_id }
}

export async function requireTeacher(pool, authorization, clock) {
  const session = await readSession(pool, requireTokenHash(authorization))
  requireActiveSession(session, clock)
  return sessionActor(session)
}

export function createTeacherAuthentication({ pool, clock, isGasRelay }) {
  return async function authenticateTeacher(request) {
    const tokenHash = requireTokenHash(request.headers.authorization)
    const now = clock()
    const session = isGasRelay(request.headers)
      ? await markSessionRelayed(pool, tokenHash, now)
      : await extendDirectSession(pool, tokenHash, now)
    const expiresAt = requireActiveSession(session, clock)
    request.teacherSession = { actor: sessionActor(session), tokenHash, expiresAt }
  }
}
