const LOGIN_PATH = '/api/v2/auth/login'

export function encodeRelayRequest({ path, token, relayPass, bodyText }) {
  const envelope = { v: 1, path }
  if (path !== LOGIN_PATH && token != null) envelope.token = token
  if (relayPass) envelope.relay_pass = relayPass
  envelope.body_text = bodyText
  return JSON.stringify(envelope)
}
