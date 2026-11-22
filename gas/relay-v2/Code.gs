const LOGIN_PATH = '/api/v2/auth/login'
const RELAY_PATHS = new Set([
  LOGIN_PATH,
  '/api/v2/auth/session',
  '/api/v2/auth/logout',
  '/api/v2/ops',
  '/api/v2/ops/lookup',
  '/api/v2/ops/cancel',
  '/api/v2/read/classes',
  '/api/v2/read/state',
  '/api/v2/read/changes',
  '/api/v2/read/export',
])

function doGet() {
  return ContentService.createTextOutput('新版轉送服務')
    .setMimeType(ContentService.MimeType.TEXT)
}

function doPost(event) {
  const contents = event?.postData?.contents
  if (typeof contents !== 'string' || utf8Size(contents) > 512 * 1024) {
    return relayError('BAD_ENVELOPE')
  }
  let envelope
  try {
    envelope = JSON.parse(contents)
  } catch {
    return relayError('BAD_ENVELOPE')
  }
  if (envelope?.v !== 1 || typeof envelope.body_text !== 'string') {
    return relayError('BAD_ENVELOPE')
  }

  const properties = PropertiesService.getScriptProperties()
  const relayPass = properties.getProperty('PPT_RELAY_PASS')
  if (relayPass && envelope.relay_pass !== relayPass) {
    return relayError('RELAY_FORBIDDEN')
  }

  const { path, token, body_text: bodyText } = envelope
  if (event.queryString || event.pathInfo || !RELAY_PATHS.has(path)) {
    return relayError('ROUTE_NOT_ALLOWED')
  }
  if (path === LOGIN_PATH) {
    if (Object.hasOwn(envelope, 'token') || utf8Size(bodyText) > 4 * 1024) {
      return relayError('BAD_ENVELOPE')
    }
  } else if (typeof token !== 'string' || token.length !== 64 || /[^0-9a-f]/.test(token)) {
    return relayError('AUTH_REQUIRED')
  }

  const backendUrl = properties.getProperty('PPT_RELAY_BACKEND_URL')
  const relayKey = properties.getProperty('PPT_V2_RELAY_KEY')
  if (!backendUrl || !relayKey) return upstreamUnreachable()

  const headers = { 'x-ppt-relay-key': relayKey }
  if (path !== LOGIN_PATH) headers.Authorization = 'Bearer ' + token
  try {
    const upstream = UrlFetchApp.fetch(backendUrl.replace(/\/+$/, '') + path, {
      method: 'post',
      contentType: 'application/json',
      payload: bodyText,
      headers,
      followRedirects: false,
      muteHttpExceptions: true,
    })
    // GAS 的請求是同步呼叫，本機替身以非同步方式取得相同的回應介面。
    if (typeof upstream.then === 'function') {
      return upstream.then(wrapUpstream).catch(upstreamUnreachable)
    }
    return wrapUpstream(upstream)
  } catch {
    return upstreamUnreachable()
  }
}

function utf8Size(text) {
  let size = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code <= 0x7f) size += 1
    else if (code <= 0x7ff) size += 2
    else if (code <= 0xffff) size += 3
    else size += 4
  }
  return size
}

function upstreamUnreachable() {
  return relayError('UPSTREAM_UNREACHABLE')
}

function relayError(code) {
  return relayOutput({ http_status: 0, gas_error: code })
}

function wrapUpstream(upstream) {
  return relayOutput({
    http_status: upstream.getResponseCode(),
    body_text: upstream.getContentText('UTF-8'),
  })
}

function relayOutput(fields) {
  return ContentService.createTextOutput(JSON.stringify({ v: 1, via: 'gas', ...fields }))
    .setMimeType(ContentService.MimeType.JSON)
}
