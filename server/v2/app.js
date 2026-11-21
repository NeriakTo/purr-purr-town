import Fastify from 'fastify'
import cors from '@fastify/cors'
import { setTimeout as wait } from 'node:timers/promises'
import { createAccountRateLimit } from './auth/account-rate-limit.js'
import { registerLoginRoute } from './auth/login.js'
import { scheduleLoginTimeout } from './auth/login-timers.js'
import { comparePassword } from './auth/password.js'
import { createRelayCheck } from './auth/relay.js'
import { registerSessionRoutes } from './auth/session-routes.js'
import { createTeacherAuthentication } from './auth/session.js'
import { logError, RequestError, sendError } from './errors.js'
import { sqlState } from './db.js'
import { defaultTimers, readBackgroundConfig, validateTimers } from './jobs/config.js'
import { registerCancelRoute } from './ops/cancel.js'
import { registerLookupRoute } from './ops/lookup.js'
import { registerSubmitRoute } from './ops/submit.js'
import { registerReadRoutes } from './read/routes.js'
import { readConfig } from './read/config.js'
import { createOriginCheck, readTrustProxy } from './request-source.js'

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
    logError(request.server.log, request.routeOptions.url, failure)
  }
  return sendError(reply, failure.code, failure.details)
}

export function buildV2App({
  pool, config = {}, clock = () => new Date(), logger, hooks, sleep = wait, verifyPassword = comparePassword,
  scheduleLoginTimer = scheduleLoginTimeout,
  timers = defaultTimers,
}) {
  const read = readConfig(config.read)
  const backgroundConfig = readBackgroundConfig(config)
  validateTimers(timers)
  const isGasRelay = createRelayCheck(config.relayKey)
  const countAccountRequest = createAccountRateLimit(clock, config.accountRateLimit)
  const authenticateTeacher = createTeacherAuthentication({ pool, clock, isGasRelay, countAccountRequest })
  const allowedOrigins = config.allowedOrigins ?? []
  const app = Fastify({
    bodyLimit: 512 * 1024,
    trustProxy: readTrustProxy(config.trustProxy),
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    ...(logger === true ? { logger: { base: null } } : { loggerInstance: logger }),
  })
  app.register(cors, { origin: allowedOrigins })
  app.addHook('onRequest', createOriginCheck(allowedOrigins, isGasRelay))
  app.setErrorHandler(handleError)
  app.removeContentTypeParser('text/plain')
  app.decorateRequest('teacherSession', null)
  app.decorate('backgroundJobContext', { pool, config: backgroundConfig, clock, timers, hooks })
  registerLoginRoute(app, { pool, config, clock, isGasRelay, sleep, verifyPassword, scheduleLoginTimer })
  registerSessionRoutes(app, { pool, clock, authenticateTeacher })
  registerSubmitRoute(app, { pool, config, clock, hooks, authenticateTeacher })
  registerCancelRoute(app, { pool, config, clock, authenticateTeacher })
  registerLookupRoute(app, { pool, clock, authenticateTeacher })
  registerReadRoutes(app, { pool, config: { ...config, read }, clock, hooks, authenticateTeacher })

  function onPoolError(error) {
    const code = error?.code
    app.log.error({ code: typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'INTERNAL_ERROR' })
  }
  pool.on('error', onPoolError)
  app.addHook('onClose', async () => pool.off('error', onPoolError))
  return app
}
