export function sendOperationRequest(fixture, endpoint, payload, { token = fixture.token, app = fixture.app } = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v2/ops/' + endpoint,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    payload,
  })
}

export function cancelViaHttp(fixture, opId, classId = fixture.target.classId, options) {
  return sendOperationRequest(fixture, 'cancel', { class_id: classId, op_id: opId }, options)
}

export function lookupViaHttp(fixture, opIds, classId = fixture.target.classId, options) {
  return sendOperationRequest(fixture, 'lookup', { class_id: classId, op_ids: opIds }, options)
}
