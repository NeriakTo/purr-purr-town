import Fastify from 'fastify'
import cors from '@fastify/cors'
import { logError, RequestError, sendError } from './errors.js'
import { sqlState } from './db.js'

const bodyErrors = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
])

function handleError(error, request, reply) {
  const failure = error instanceof RequestError ? error : new RequestError(
    bodyErrors.has(error?.code) ? 'BAD_ENVELOPE' : 'INTERNAL_ERROR',
    sqlState(error),
  )
  if (failure.code === 'INTERNAL_ERROR' || failure.code === 'SERVER_BUSY') {
    logError(request.log, request.routeOptions.url, failure)
  }
  return sendError(reply, failure.code)
}

export function buildV2App({ pool, config = {}, logger }) {
  const app = Fastify({
    bodyLimit: 512 * 1024,
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    ...(logger === true ? { logger: true } : { loggerInstance: logger }),
  })
  app.register(cors, { origin: config.allowedOrigins ?? [] })
  app.setErrorHandler(handleError)
  app.removeContentTypeParser('text/plain')

  function onPoolError(error) {
    const code = error?.code
    app.log.error({ code: typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'INTERNAL_ERROR' })
  }
  pool.on('error', onPoolError)
  app.addHook('onClose', async () => pool.off('error', onPoolError))
  return app
}
