export const relayKey = 'fake-relay-key-for-tests-only-000000000000'
export const relayHeaders = { 'x-ppt-relay-key': relayKey }

export function postAuth(app, endpoint, { token, headers, body } = {}) {
  return app.inject({
    method: 'POST', url: '/api/v2/auth/' + endpoint,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
}
