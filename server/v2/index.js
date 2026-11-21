import pg from 'pg'
import { buildV2App } from './app.js'
import { createBackgroundJobList, startBackgroundJobs } from './jobs/background-jobs.js'

const {
  PPT_V2_DATABASE_URL,
  PPT_V2_HOST,
  PPT_V2_PORT,
  PPT_V2_ALLOWED_ORIGINS,
  PPT_V2_LOCK_TIMEOUT_MS,
  PPT_V2_STATEMENT_TIMEOUT_MS,
  PPT_V2_RELAY_KEY,
  PPT_V2_TRUST_PROXY,
  UV_THREADPOOL_SIZE,
} = process.env

const port = Number(PPT_V2_PORT)
if (!PPT_V2_DATABASE_URL || !PPT_V2_HOST || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('請設定 PPT_V2_DATABASE_URL、PPT_V2_HOST 與有效的 PPT_V2_PORT')
}

const pool = new pg.Pool({ connectionString: PPT_V2_DATABASE_URL, connectionTimeoutMillis: 5000 })
const app = buildV2App({
  pool,
  logger: true,
  config: {
    relayKey: PPT_V2_RELAY_KEY,
    trustProxy: PPT_V2_TRUST_PROXY?.split(',').map(address => address.trim()).filter(Boolean),
    allowedOrigins: PPT_V2_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
    lockTimeoutMs: PPT_V2_LOCK_TIMEOUT_MS === undefined ? undefined : Number(PPT_V2_LOCK_TIMEOUT_MS),
    statementTimeoutMs: PPT_V2_STATEMENT_TIMEOUT_MS === undefined ? undefined : Number(PPT_V2_STATEMENT_TIMEOUT_MS),
    login: { threadPoolSize: UV_THREADPOOL_SIZE === undefined ? 4 : Number(UV_THREADPOOL_SIZE) },
  },
})

let backgroundJobs
app.addHook('onClose', async () => {
  await backgroundJobs?.stop()
  await pool.end()
})
try {
  await app.listen({ host: PPT_V2_HOST, port })
  backgroundJobs = startBackgroundJobs(app, { jobs: createBackgroundJobList() })
} catch {
  app.log.error({ code: 'STARTUP_FAILED' })
  await app.close()
  process.exitCode = 1
}
