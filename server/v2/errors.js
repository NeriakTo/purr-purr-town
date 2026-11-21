const httpStatuses = {
  BAD_ENVELOPE: 400,
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  LOGIN_FAILED: 401,
  CLASS_FORBIDDEN: 403,
  SERVER_BUSY: 503,
  INTERNAL_ERROR: 500,
}

export class RequestError extends Error {
  constructor(code, sqlState) {
    super(code)
    this.code = code
    this.sqlState = sqlState
  }
}

export function sendError(reply, code) {
  return reply.code(httpStatuses[code]).send({ error: { code } })
}

export function logError(logger, route, error) {
  logger.error({ route, code: error.code, sqlstate: error.sqlState })
}
