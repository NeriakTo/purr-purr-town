import {
  getDeviceSetting, getLocalLogin, getLocalLoginInTransaction, runStorageTransaction,
  saveLocalLoginInTransaction, saveDeviceSettingInTransaction,
} from '../storage/queue-storage.js'

export const BUCKET_BUSY_MESSAGE = '有人正在嘗試這個帳號的密碼。請先用登入過的裝置。這台電腦一定要登入時，請通知維護者'
export const RATE_LIMITED_MESSAGE = '目前登入的請求很多，請過幾秒再試。登入過的裝置不受影響'

export const LOGIN_RESULT_KINDS = Object.freeze([
  'success', 'invalid_input', 'invalid_response', 'login_failed', 'bucket_busy', 'rate_limited',
  'relay_pass_required', 'unreachable', 'server_error', 'bad_envelope', 'storage_error',
])

const LOGIN_PATH = '/api/v2/auth/login'
const SESSION_PATH = '/api/v2/auth/session'
const LOGIN_BODY_LIMIT = 4 * 1024
const TOKEN_PATTERN = /^[0-9a-f]{64}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const HTTP_ERROR_CODES = new Map([
  [400, 'BAD_ENVELOPE'], [403, 'ORIGIN_FORBIDDEN'], [500, 'INTERNAL_ERROR'], [503, 'SERVER_BUSY'],
])
const encoder = new TextEncoder()

function isTokenOrMarker(value) {
  return typeof value === 'string' && value.length === 64 && TOKEN_PATTERN.test(value)
}

function isTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
}

function isSessionBody(body) {
  return typeof body?.teacher?.id === 'string' && body.teacher.id.length > 0 &&
    typeof body.teacher.name === 'string' && isTimestamp(body.expires_at) && isTimestamp(body.server_time)
}

async function sendAuthRequest(transport, request) {
  let response
  try {
    response = await transport.send(request)
  } catch {
    return { kind: 'unreachable' }
  }
  if (response.kind === 'http') {
    try {
      return { kind: 'http', via: response.via, status: response.status, body: JSON.parse(response.bodyText) }
    } catch {
      return { kind: 'invalid_response' }
    }
  }
  if (response.kind === 'lost') return { kind: 'unreachable' }
  return response
}

function authFailure({ kind, status, code, body }) {
  if (kind === 'unreachable' || kind === 'invalid_response') return { kind }
  if (kind === 'gas_error') {
    if (code === 'UPSTREAM_UNREACHABLE') return { kind: 'unreachable' }
    if (code === 'RELAY_FORBIDDEN') return { kind: 'relay_pass_required' }
    if (code === 'BAD_ENVELOPE') return { kind: 'bad_envelope', code }
    if (code === 'ROUTE_NOT_ALLOWED') return { kind: 'server_error', code }
  }
  const expectedCode = HTTP_ERROR_CODES.get(status)
  if (kind === 'http' && expectedCode && expectedCode === body?.error?.code) {
    return { kind: status === 400 ? 'bad_envelope' : 'server_error', code: body.error.code }
  }
  return { kind: 'invalid_response' }
}

function rateLimitResult({ retry_after, reason }, forLogin) {
  if (!Number.isInteger(retry_after) || retry_after < 0) return { kind: 'invalid_response' }
  if (forLogin && reason === 'bucket_busy') return { kind: 'bucket_busy', message: BUCKET_BUSY_MESSAGE, retry_after }
  if (reason !== undefined) return { kind: 'invalid_response' }
  if (forLogin) return { kind: 'rate_limited', message: RATE_LIMITED_MESSAGE, retry_after }
  return { kind: 'rate_limited', retry_after }
}

export async function login({ db, transport, clock }, { name, passcode }) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 50 ||
      typeof passcode !== 'string' || passcode.length === 0) return { kind: 'invalid_input' }

  const markerKey = 'device_marker:' + name
  let marker
  try {
    marker = await getDeviceSetting(db, markerKey)
  } catch {
    return { kind: 'storage_error' }
  }
  const requestBody = { name, passcode }
  if (isTokenOrMarker(marker)) requestBody.device_marker = marker
  const bodyText = JSON.stringify(requestBody)
  if (encoder.encode(bodyText).length > LOGIN_BODY_LIMIT) return { kind: 'invalid_input' }

  const response = await sendAuthRequest(transport, { path: LOGIN_PATH, bodyText })
  if (response.kind !== 'http') return authFailure(response)

  const { body, status, via } = response
  if (status === 401 && body?.error?.code === 'LOGIN_FAILED') return { kind: 'login_failed' }
  if (status === 429 && body?.error?.code === 'RATE_LIMITED') return rateLimitResult(body.error, true)
  if (status !== 200) return authFailure(response)
  if (!isSessionBody(body) || !isTokenOrMarker(body.token) || !isTokenOrMarker(body.device_marker)) {
    return { kind: 'invalid_response' }
  }

  const loggedInAt = clock.now()
  const record = {
    accountId: body.teacher.id,
    teacherName: body.teacher.name,
    token: body.token,
    expiresAt: body.expires_at,
    loginVia: via,
    firstRelayedAt: via === 'gas' ? loggedInAt : null,
    requiresLogin: false,
    loggedInAt,
  }
  try {
    await runStorageTransaction(db, ['localLogin', 'deviceSettings'], 'readwrite', async tx => {
      await saveLocalLoginInTransaction(tx, record)
      await saveDeviceSettingInTransaction(tx, markerKey, body.device_marker)
    })
  } catch {
    return { kind: 'storage_error' }
  }
  return { kind: 'success', accountId: record.accountId, teacherName: record.teacherName }
}

async function updateMatchingLogin(db, token, update) {
  return runStorageTransaction(db, 'localLogin', 'readwrite', async tx => {
    const current = await getLocalLoginInTransaction(tx)
    if (!current || current.token !== token) return false
    const patch = update(current)
    if (patch) await saveLocalLoginInTransaction(tx, { ...current, ...patch })
    return true
  })
}

export function markSessionRequiresLogin({ db }, token) {
  if (!isTokenOrMarker(token)) return Promise.resolve(false)
  return updateMatchingLogin(db, token, current => current.requiresLogin ? null : { requiresLogin: true })
}

export async function querySession({ db, transport, clock }) {
  let current
  try {
    current = await getLocalLogin(db)
  } catch {
    return { kind: 'storage_error' }
  }
  if (!isTokenOrMarker(current?.token)) return { kind: 'no_login' }

  const { token, accountId } = current
  const response = await sendAuthRequest(transport, { path: SESSION_PATH, token, bodyText: '{}' })
  const { kind, status, body } = response
  const backendCode = body?.error?.code
  const authCode = kind === 'gas_error' ? response.code : status === 401 ? backendCode : undefined
  try {
    if (authCode === 'AUTH_REQUIRED' || authCode === 'AUTH_EXPIRED') {
      const applied = await markSessionRequiresLogin({ db }, token)
      return applied ? { kind: 'requires_login', code: authCode } : { kind: 'stale_session' }
    }
    if (status === 429 && backendCode === 'RATE_LIMITED') return rateLimitResult(body.error, false)
    if (status !== 200) return authFailure(response)
    if (!isSessionBody(body) || body.teacher.id !== accountId) return { kind: 'invalid_response' }

    const applied = await updateMatchingLogin(db, token, () => ({
      expiresAt: body.expires_at, requiresLogin: false,
    }))
    return applied ? { kind: 'success', checkedAt: clock.now() } : { kind: 'stale_session' }
  } catch {
    return { kind: 'storage_error' }
  }
}
