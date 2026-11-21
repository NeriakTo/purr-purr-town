import { randomBytes } from 'node:crypto'
import { readQuery, writeTransaction } from '../db.js'
import { logError, RequestError } from '../errors.js'
import { createDeviceMarker, readDeviceMarker } from './device-marker.js'
import { createLoginBuckets } from './login-buckets.js'
import { createPasswordCheck } from './password.js'
import { hashSessionToken, sessionExpiresAt, sessionLifetimeMs } from './session.js'

const loginPath = '/api/v2/auth/login'

function readLoginEnvelope(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('BAD_ENVELOPE')
  const { name, passcode, device_marker: marker } = body
  if (typeof name !== 'string' || name.length < 1 || name.length > 50
    || typeof passcode !== 'string' || passcode.length < 1) {
    throw new RequestError('BAD_ENVELOPE')
  }
  return { name, passcode, marker }
}

async function readTeacherCandidates(pool, name) {
  // PostgreSQL 的文字欄位無法保存 NUL，這種名稱不會有對應的老師。
  if (name.includes('\u0000')) return []
  const { rows } = await readQuery(pool, `
    SELECT id, name, passcode_hash FROM public.teachers WHERE name = $1 LIMIT 2
  `, [name])
  return rows
}

function issueLogin({ pool, config, clock }, teacher, existingMarker, relayed) {
  const token = randomBytes(32).toString('hex')
  const now = clock()
  const session = {
    expires_at: new Date(now.getTime() + sessionLifetimeMs),
    first_relayed_at: relayed ? now : null,
  }
  return writeTransaction(pool, config, async client => {
    await client.query(`
      INSERT INTO ppt_web_state.sessions (token_hash, teacher_id, created_at, expires_at, first_relayed_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [hashSessionToken(token), teacher.id, now, session.expires_at, session.first_relayed_at])
    const marker = existingMarker ?? await createDeviceMarker(client, teacher.id, now)
    return {
      server_time: now.toISOString(),
      token,
      expires_at: new Date(sessionExpiresAt(session)).toISOString(),
      device_marker: marker,
      teacher: { id: teacher.id, name: teacher.name },
    }
  })
}

export function registerLoginRoute(app, context) {
  const { pool, config, isGasRelay, verifyPassword } = context
  const verifyLoginPassword = createPasswordCheck(verifyPassword, config.login?.dummyHashCost)
  const verifyInBucket = createLoginBuckets(context)
  app.post(loginPath, { bodyLimit: 4 * 1024 }, async request => {
    const { name, passcode, marker } = readLoginEnvelope(request.body)
    const relayed = isGasRelay(request.headers)
    const candidates = await readTeacherCandidates(pool, name)
    const teacher = candidates.length === 1 ? candidates[0] : undefined
    const existingMarker = await readDeviceMarker(pool, marker, teacher)
    const verified = await verifyInBucket({ name, marker: existingMarker, relayed, ip: request.ip }, () => {
      if (candidates.length > 1) {
        logError(app.log, loginPath, { code: 'DUPLICATE_LOGIN_NAME' })
        return false
      }
      return verifyLoginPassword(passcode, teacher)
    })
    if (!verified) throw new RequestError('LOGIN_FAILED')
    return issueLogin(context, teacher, existingMarker, relayed)
  })
}
