const httpStatuses = {
  BAD_ENVELOPE: 400,
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  LOGIN_FAILED: 401,
  CLASS_FORBIDDEN: 403,
  ORIGIN_FORBIDDEN: 403,
  RATE_LIMITED: 429,
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

export function rateLimitError(retryAfter, reason) {
  const error = new RequestError('RATE_LIMITED')
  error.details = { retry_after: retryAfter, ...(reason === undefined ? {} : { reason }) }
  return error
}

export function sendError(reply, code, details) {
  return reply.code(httpStatuses[code]).send({ error: { code, ...details } })
}

export function logError(logger, route, error) {
  logger.error({ route, code: error.code, sqlstate: error.sqlState })
}
