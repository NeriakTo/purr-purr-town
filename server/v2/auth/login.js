import { randomBytes } from 'node:crypto'
import { readQuery, writeTransaction } from '../db.js'
import { logError, RequestError } from '../errors.js'
import { createDeviceMarker, readDeviceMarker } from './device-marker.js'
import { createLoginAdmission, createLoginRejections, loginCategory } from './login-admission.js'
import { createLoginBuckets } from './login-buckets.js'
import { readLoginOptions } from './login-options.js'
import { createLoginDeadline } from './login-timers.js'
import { createVerifySlots } from './login-verify-slots.js'
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
    SELECT id, name, passcode_hash, TRUNC(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at
    FROM public.teachers WHERE name = $1 LIMIT 2
  `, [name])
  return rows.map(teacher => ({ ...teacher, created_at: readCreationTime(teacher.created_at) }))
}

function readCreationTime(value) {
  // pg 將時間戳讀成 Date 時會失去微秒，改用自 Unix 紀元起的整數微秒排序。
  if (value === null) return null
  if (value === 'Infinity' || value === '-Infinity') return Number(value)
  return BigInt(value)
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

function holdUntilResponse(response, release) {
  let finishedProcessing = false
  let released = false
  function finish() {
    if (released) return
    released = true
    response.off('finish', finish)
    response.off('close', close)
    release()
  }
  function close() {
    if (finishedProcessing) finish()
  }
  response.once('finish', finish)
  response.once('close', close)
  return function finishProcessing() {
    finishedProcessing = true
    if (response.destroyed) finish()
  }
}

export function registerLoginRoute(app, context) {
  const { pool, config, clock, isGasRelay, verifyPassword, scheduleLoginTimer } = context
  const options = readLoginOptions(config.login)
  const scheduleDeadline = createLoginDeadline(clock, scheduleLoginTimer)
  const rejectLogin = createLoginRejections(app, loginPath, scheduleLoginTimer)
  const admitLogin = createLoginAdmission(context, options, scheduleDeadline)
  const acquireSlot = createVerifySlots(context, options, scheduleDeadline)
  const preparePasswordCheck = createPasswordCheck(verifyPassword, options.dummyHashCost)
  const verifyInBucket = createLoginBuckets(context, options, { acquireSlot, scheduleDeadline, rejectLogin })
  app.post(loginPath, { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const { name, passcode, marker } = readLoginEnvelope(request.body)
    const relayed = isGasRelay(request.headers)
    const candidates = await readTeacherCandidates(pool, name)
    const teacher = candidates.length === 1 ? candidates[0] : undefined
    const existingMarker = await readDeviceMarker(pool, marker, teacher)
    const category = loginCategory(existingMarker, relayed)
    const release = await admitLogin(category, teacher)
    if (!release) rejectLogin(category)

    const finishProcessing = holdUntilResponse(reply.raw, release)
    try {
      const attempt = { name, marker: existingMarker, relayed, ip: request.ip, category, teacher }
      const verified = await verifyInBucket(attempt, checkPassword)
      if (!verified) throw new RequestError('LOGIN_FAILED')
      return await issueLogin(context, teacher, existingMarker, relayed)
    } finally {
      finishProcessing()
    }

    async function checkPassword(compare) {
      if (candidates.length > 1) {
        logError(app.log, loginPath, { code: 'DUPLICATE_LOGIN_NAME' })
        return false
      }
      return compare(await preparePasswordCheck(passcode, teacher))
    }
  })
}
