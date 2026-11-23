import { encodeRelayRequest } from './relay-envelope.js'

export const DEFAULT_DIRECT_HEADERS_TIMEOUT_MS = 8_000
export const DEFAULT_GAS_HEADERS_TIMEOUT_MS = 65_000
export const DEFAULT_BODY_TIMEOUT_MS = 30_000
export const DEFAULT_ROUTE_MEMORY_MS = 5 * 60_000
export const DEFAULT_RETRY_DIRECT_ON_REMEMBERED_GAS_FAILURE = false
export const defaultIsRouteSuccess = ({ status }) => isHttpStatus(status)

const GAS_ERRORS = new Set([
  'BAD_ENVELOPE', 'RELAY_FORBIDDEN', 'ROUTE_NOT_ALLOWED', 'AUTH_REQUIRED', 'UPSTREAM_UNREACHABLE',
])
const TIMEOUT = Symbol('逾時')
const FAILED = Symbol('失敗')
const bodyDecoder = new TextDecoder('utf-8', { ignoreBOM: true })
const lost = (via, reason) => ({ kind: 'lost', via, reason })
const isHttpStatus = status => Number.isInteger(status) && status >= 100 && status <= 599

export function createMemoryRelayPassStore(initialPass = null) {
  let relayPass = initialPass
  return {
    read: () => relayPass,
    write: value => { relayPass = value },
  }
}

function parseEndpoint(value) {
  if (typeof value !== 'string' || /[?#]/.test(value)) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function decodeRelayResponse(text) {
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    return lost('gas', 'invalid_envelope')
  }
  if (envelope?.v === 1) {
    const { http_status: status, body_text: bodyText, gas_error: code } = envelope
    if (isHttpStatus(status) && typeof bodyText === 'string') {
      return { kind: 'http', via: 'gas', status, bodyText }
    }
    if (status === 0 && GAS_ERRORS.has(code)) {
      return { kind: 'gas_error', via: 'gas', code }
    }
  }
  return lost('gas', 'invalid_envelope')
}

export function createTransport({
  fetch, backendOrigin, gasUrl, relayPassStore, clock,
  directHeadersTimeoutMs = DEFAULT_DIRECT_HEADERS_TIMEOUT_MS,
  gasHeadersTimeoutMs = DEFAULT_GAS_HEADERS_TIMEOUT_MS,
  bodyTimeoutMs = DEFAULT_BODY_TIMEOUT_MS,
  routeMemoryMs = DEFAULT_ROUTE_MEMORY_MS,
  retryDirectOnRememberedGasFailure = DEFAULT_RETRY_DIRECT_ON_REMEMBERED_GAS_FAILURE,
  isRouteSuccess = defaultIsRouteSuccess,
}) {
  const backend = parseEndpoint(backendOrigin)
  const relay = parseEndpoint(gasUrl)
  let rememberedRoute = null

  function getActiveRoute() {
    if (rememberedRoute && rememberedRoute.expiresAt <= clock.now()) rememberedRoute = null
    return rememberedRoute
  }

  function getRememberedRoute() {
    const route = getActiveRoute()
    return route && { ...route }
  }

  function remember(metadata) {
    if (!isRouteSuccess(metadata) || getRememberedRoute()?.via === metadata.via) return
    // 同一路徑在記憶期間內再次成功不延長期限，讓下一個時間窗能重新試直連。
    rememberedRoute = { via: metadata.via, expiresAt: clock.now() + routeMemoryMs }
  }

  async function withinTimeout(run, timeoutMs, controller) {
    let timer
    try {
      const deadline = new Promise(resolve => {
        timer = clock.setTimeout(() => {
          resolve(TIMEOUT)
          controller.abort()
        }, timeoutMs)
      })
      return await Promise.race([deadline, run()])
    } catch {
      return FAILED
    } finally {
      clock.clearTimeout(timer)
    }
  }

  async function attempt(via, url, options, headersTimeoutMs) {
    const controller = new AbortController()
    const response = await withinTimeout(
      () => fetch(url, { method: 'POST', ...options, signal: controller.signal }),
      headersTimeoutMs, controller,
    )
    if (response === FAILED || response === TIMEOUT) {
      return {
        missingHeaders: true,
        result: lost(via, response === TIMEOUT ? 'headers_timeout' : 'fetch_failed'),
      }
    }

    const status = response.status
    if (via === 'direct' && isHttpStatus(status)) remember({ via, status })
    if (via === 'gas' ? status !== 200 : !isHttpStatus(status)) {
      controller.abort()
      return via === 'direct'
        ? { missingHeaders: true, result: lost(via, 'unreadable_response') }
        : { result: lost(via, 'relay_http_status') }
    }

    const readBody = via === 'direct'
      ? async () => bodyDecoder.decode(await response.arrayBuffer())
      : () => response.text()
    const bodyText = await withinTimeout(readBody, bodyTimeoutMs, controller)
    if (typeof bodyText !== 'string') {
      return { result: lost(via, bodyText === TIMEOUT ? 'body_timeout' : 'body_failed') }
    }
    if (via === 'direct') return { result: { kind: 'http', via, status, bodyText } }

    const result = decodeRelayResponse(bodyText)
    if (result.kind === 'http') remember({ via, status: result.status })
    if (result.kind === 'gas_error') remember({ via, code: result.code })
    return { result }
  }

  function sendDirect({ path, token, bodyText }) {
    if (!backend || backend.pathname !== '/') return { result: lost('direct', 'invalid_url') }
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = 'Bearer ' + token
    return attempt('direct', backend.origin + path, { headers, body: bodyText, redirect: 'manual' },
      directHeadersTimeoutMs)
  }

  async function sendGas(request) {
    if (!relay) return { result: lost('gas', 'invalid_url') }
    let relayPass
    try {
      relayPass = await relayPassStore.read()
    } catch {
      return { result: lost('gas', 'relay_pass_failed') }
    }
    return attempt('gas', gasUrl, {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: encodeRelayRequest({ ...request, relayPass }),
    }, gasHeadersTimeoutMs)
  }

  async function send({ path, token, bodyText }) {
    const route = getActiveRoute()
    const via = route?.via ?? 'direct'
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path) ||
        /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) {
      return lost(via, 'invalid_path')
    }
    if (typeof bodyText !== 'string' || (token != null && typeof token !== 'string')) {
      return lost(via, 'invalid_request')
    }
    const request = { path, token, bodyText }
    if (via === 'gas') {
      const gas = await sendGas(request)
      const { kind, reason, code } = gas.result
      if (rememberedRoute === route &&
          ((kind === 'lost' && reason !== 'relay_pass_failed') || code === 'UPSTREAM_UNREACHABLE')) {
        rememberedRoute = null
      }
      if (!gas.missingHeaders || !retryDirectOnRememberedGasFailure) return gas.result
      const direct = await sendDirect(request)
      return { ...direct.result, attemptedGas: true }
    }

    const direct = await sendDirect(request)
    if (!direct.missingHeaders || !gasUrl) return direct.result
    return (await sendGas(request)).result
  }

  return { send, getRememberedRoute }
}
