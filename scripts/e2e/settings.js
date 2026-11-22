// 瀏覽器測試與本機後端共用的設定。主機位址固定 127.0.0.1，只有埠、老師名稱與映像可由環境變數改。
export const LOOPBACK = '127.0.0.1'
export const DEFAULT_PORTS = Object.freeze({ web: 4317, api: 3317, db: 55417 })
export const DATABASE_NAME = 'ppt_e2e'
export const TEACHER_ID = 'e2e-teacher'
export const READY_TOKEN = 'E2E_BACKEND_READY'

const DEFAULT_TEACHER_NAME = 'e2e-teacher'
const DEFAULT_POSTGRES_IMAGE = 'postgres:16'
const POSTGRES_16 = /^postgres:16(?:[.-][\w.-]*)?(?:@sha256:[0-9a-f]{64})?$/

export function readPort(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 須是 1 到 65535 的整數，收到：${JSON.stringify(raw)}`)
  const port = Number(raw)
  if (port < 1 || port > 65535) throw new Error(`${name} 須是 1 到 65535 的整數，收到：${JSON.stringify(raw)}`)
  return port
}

export function readE2eSettings(env) {
  const webPort = readPort(env, 'PPT_E2E_WEB_PORT', DEFAULT_PORTS.web)
  const apiPort = readPort(env, 'PPT_E2E_API_PORT', DEFAULT_PORTS.api)
  const dbPort = readPort(env, 'PPT_E2E_DB_PORT', DEFAULT_PORTS.db)
  if (new Set([webPort, apiPort, dbPort]).size !== 3) {
    throw new Error(`網頁、後端、資料庫須用不同的埠，目前是 ${webPort}、${apiPort}、${dbPort}`)
  }

  const teacherName = env.PPT_E2E_TEACHER_NAME ?? DEFAULT_TEACHER_NAME
  if (typeof teacherName !== 'string' || teacherName.length < 1 || teacherName.length > 50) {
    throw new Error('PPT_E2E_TEACHER_NAME 須是 1 到 50 字')
  }

  const postgresImage = env.PPT_E2E_POSTGRES_IMAGE ?? DEFAULT_POSTGRES_IMAGE
  if (!POSTGRES_16.test(postgresImage)) {
    throw new Error(`PPT_E2E_POSTGRES_IMAGE 須是 PostgreSQL 16 的映像（例如 postgres:16），收到：${JSON.stringify(postgresImage)}`)
  }

  return Object.freeze({
    host: LOOPBACK,
    webPort,
    apiPort,
    dbPort,
    webOrigin: `http://${LOOPBACK}:${webPort}`,
    apiOrigin: `http://${LOOPBACK}:${apiPort}`,
    teacherName,
    postgresImage,
  })
}

// 後端程序只拿到執行需要的變數，不繼承上層環境的其他 PPT_V2_* 或資料庫設定。
export function buildBackendEnv(settings, { webPassword, database, parentEnv }) {
  const databaseUrl = new URL(`postgresql://${LOOPBACK}:${settings.dbPort}/`)
  databaseUrl.username = 'ppt_web'
  databaseUrl.password = encodeURIComponent(webPassword)
  databaseUrl.pathname = '/' + database
  const env = {
    PPT_V2_DATABASE_URL: databaseUrl.href,
    PPT_V2_HOST: LOOPBACK,
    PPT_V2_PORT: String(settings.apiPort),
    PPT_V2_ALLOWED_ORIGINS: settings.webOrigin,
  }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
    if (parentEnv[key] !== undefined) env[key] = parentEnv[key]
  }
  return env
}

export function dockerRunArgs(settings, { containerName, envFile }) {
  return [
    'run', '--detach', '--rm', '--pull=never',
    '--name', containerName,
    '--label', 'purrtown.e2e=1',
    '--publish', `${LOOPBACK}:${settings.dbPort}:5432`,
    '--env-file', envFile,
    settings.postgresImage,
  ]
}
