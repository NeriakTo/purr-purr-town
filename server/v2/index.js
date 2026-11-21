import pg from 'pg'
import { buildV2App } from './app.js'

const {
  PPT_V2_DATABASE_URL,
  PPT_V2_HOST,
  PPT_V2_PORT,
  PPT_V2_ALLOWED_ORIGINS,
  PPT_V2_LOCK_TIMEOUT_MS,
  PPT_V2_STATEMENT_TIMEOUT_MS,
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
    allowedOrigins: PPT_V2_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
    lockTimeoutMs: PPT_V2_LOCK_TIMEOUT_MS === undefined ? undefined : Number(PPT_V2_LOCK_TIMEOUT_MS),
    statementTimeoutMs: PPT_V2_STATEMENT_TIMEOUT_MS === undefined ? undefined : Number(PPT_V2_STATEMENT_TIMEOUT_MS),
  },
})

app.addHook('onClose', async () => pool.end())
try {
  await app.listen({ host: PPT_V2_HOST, port })
} catch {
  app.log.error({ code: 'STARTUP_FAILED' })
  await app.close()
  process.exitCode = 1
}
