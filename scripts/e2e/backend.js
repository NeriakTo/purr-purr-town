// 本機起新版後端加 PostgreSQL 16 測試庫，給需要後端的瀏覽器測試用。
//
// 做法照 server/db-v2/README.md、server/v2/README.md 與 deploy/test-env/README.md：
//   1. 用 docker 起一個自己的 PostgreSQL 16 容器（只綁 127.0.0.1，不自動下載映像）
//   2. 以 server/test-env/setup.js 的 setupDatabase 建角色、建庫、裝舊表與兩套新版 SQL、寫入測試老師
//   3. 以 ppt_web 身分起 server/v2/index.js，只綁 127.0.0.1，只允許測試網頁的來源
// 就緒後在標準輸出印一行 E2E_BACKEND_READY。收到 SIGINT 或 SIGTERM 時，只停自己啟動的後端程序
// 與自己建立的容器，再刪掉暫存目錄。
//
// 需先在 server/ 執行過 npm ci。可設的環境變數見 scripts/e2e/settings.js；
// 測試老師密碼可由 PPT_E2E_TEACHER_PASSWORD 指定，沒給時隨機產生並寫進暫存目錄的檔案。
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  buildBackendEnv, DATABASE_NAME, dockerRunArgs, LOOPBACK, READY_TOKEN, readE2eSettings, TEACHER_ID,
} from './settings.js'

const run = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const serverDir = join(repoRoot, 'server')
const DB_READY_TIMEOUT_MS = 60_000
const API_READY_TIMEOUT_MS = 30_000
const BACKEND_STOP_TIMEOUT_MS = 10_000

const say = message => process.stderr.write(`[e2e 後端] ${message}\n`)

class StartupError extends Error {}

function randomSecret() {
  return randomBytes(24).toString('hex')
}

async function waitForDatabase(pg, adminUrl, ensureRunning) {
  const deadline = Date.now() + DB_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    ensureRunning()
    const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return
    } catch {
      await delay(500)
    } finally {
      await client.end().catch(() => {})
    }
  }
  throw new StartupError(`測試庫 ${DB_READY_TIMEOUT_MS / 1000} 秒內沒有就緒`)
}

async function waitForApi(apiOrigin, backendExited) {
  const deadline = Date.now() + API_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (backendExited()) throw new StartupError('後端程序在就緒前結束')
    try {
      const response = await fetch(`${apiOrigin}/api/v2/auth/session`, { method: 'POST' })
      if (response.status === 401) return
    } catch {
      // 還沒開始監聽，稍後再試
    }
    await delay(250)
  }
  throw new StartupError(`後端 ${API_READY_TIMEOUT_MS / 1000} 秒內沒有就緒`)
}

function createLifecycle() {
  const state = {
    stopping: false,
    containerName: null,
    dockerRun: null,
    containerId: null,
    backend: null,
    backendExit: null,
    tempDir: null,
  }
  let cleaning = null

  async function stopBackend() {
    const { backend } = state
    if (!backend || backend.exitCode !== null || backend.signalCode !== null) return
    backend.kill('SIGTERM')
    const exited = await Promise.race([state.backendExit.then(() => true), delay(BACKEND_STOP_TIMEOUT_MS, false)])
    if (!exited) {
      say(`後端程序 ${backend.pid} 沒有在時限內結束，強制停止`)
      backend.kill('SIGKILL')
      await state.backendExit
    }
  }

  // 只移除本次建立的容器：有容器編號用編號，docker run 被中斷時用本次產生的唯一名稱。
  async function removeContainer() {
    if (state.dockerRun) await state.dockerRun.catch(() => {})
    const target = state.containerId ?? state.containerName
    if (!target) return
    try {
      await run('docker', ['rm', '--force', target])
      say('已移除本次建立的資料庫容器')
    } catch (error) {
      if (!state.containerId && /no such container/i.test(error.stderr ?? '')) return
      say(`移除資料庫容器失敗，請手動執行 docker rm --force ${target}：${error.stderr?.trim() || error.message}`)
    }
  }

  function cleanup() {
    state.stopping = true
    cleaning ??= (async () => {
      await stopBackend().catch(error => say(`停止後端程序失敗：${error.message}`))
      await removeContainer()
      if (state.tempDir) await rm(state.tempDir, { recursive: true, force: true }).catch(() => {})
    })()
    return cleaning
  }

  return { state, cleanup }
}

async function start(settings, state) {
  const ensureRunning = () => {
    if (state.stopping) throw new StartupError('已要求停止')
  }
  if (!existsSync(join(serverDir, 'node_modules', 'pg'))) {
    throw new StartupError('server/ 還沒安裝套件，請先在 server/ 執行 npm ci')
  }
  const serverRequire = createRequire(join(serverDir, 'package.json'))
  const pg = serverRequire('pg')
  const { setupDatabase } = await import('../../server/test-env/setup.js')

  state.tempDir = await mkdtemp(join(tmpdir(), 'ppt-e2e-backend-'))
  const postgresPassword = randomSecret()
  const webPassword = randomSecret()
  let teacherPassword = process.env.PPT_E2E_TEACHER_PASSWORD
  if (!teacherPassword) {
    teacherPassword = randomSecret()
    const passwordFile = join(state.tempDir, 'teacher-password')
    await writeFile(passwordFile, teacherPassword + '\n', { mode: 0o600 })
    say(`測試老師密碼已寫入 ${passwordFile}（停止時刪除）`)
  }

  const envFile = join(state.tempDir, 'postgres.env')
  await writeFile(envFile, `POSTGRES_PASSWORD=${postgresPassword}\n`, { mode: 0o600 })
  const containerName = `ppt-e2e-${randomBytes(4).toString('hex')}`
  ensureRunning()
  say(`啟動資料庫容器 ${containerName}（${settings.postgresImage}，127.0.0.1:${settings.dbPort}）`)
  try {
    state.containerName = containerName
    state.dockerRun = run('docker', dockerRunArgs(settings, { containerName, envFile }))
    const { stdout } = await state.dockerRun
    state.containerId = stdout.trim()
  } catch (error) {
    ensureRunning()
    throw new StartupError(`無法啟動資料庫容器（docker 是否可用、映像 ${settings.postgresImage} 是否已在本機、埠 ${settings.dbPort} 是否被占用）：${error.stderr?.trim() || error.message}`)
  }

  const adminUrl = `postgresql://postgres:${postgresPassword}@${LOOPBACK}:${settings.dbPort}/postgres`
  await waitForDatabase(pg, adminUrl, ensureRunning)
  ensureRunning()
  say('建立測試庫與測試老師')
  await setupDatabase({
    adminUrl,
    database: DATABASE_NAME,
    webPassword,
    teacherId: TEACHER_ID,
    teacherName: settings.teacherName,
    demoPassword: teacherPassword,
  })

  ensureRunning()
  say(`啟動新版後端（${settings.apiOrigin}）`)
  const backend = spawn(process.execPath, [join(serverDir, 'v2', 'index.js')], {
    cwd: serverDir,
    env: buildBackendEnv(settings, { webPassword, database: DATABASE_NAME, parentEnv: process.env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  state.backend = backend
  state.backendExit = new Promise(resolve => backend.once('exit', (code, signal) => resolve({ code, signal })))
  backend.stdout.pipe(process.stdout)
  backend.stderr.pipe(process.stderr)
  await waitForApi(settings.apiOrigin, () => backend.exitCode !== null || backend.signalCode !== null)

  process.stdout.write(`${READY_TOKEN} api=${settings.apiOrigin} web=${settings.webOrigin} teacher=${settings.teacherName}\n`)
  say(`就緒，後端程序 PID ${backend.pid}；按 Ctrl+C 停止`)
}

async function main() {
  let settings
  try {
    settings = readE2eSettings(process.env)
  } catch (error) {
    say(error.message)
    process.exitCode = 1
    return
  }

  const { state, cleanup } = createLifecycle()
  let stopping = false
  const stop = async code => {
    if (stopping) return
    stopping = true
    await cleanup()
    process.exit(code)
  }
  process.on('SIGINT', () => {
    say('收到 SIGINT，停止中')
    stop(0)
  })
  process.on('SIGTERM', () => {
    say('收到 SIGTERM，停止中')
    stop(0)
  })

  try {
    await start(settings, state)
  } catch (error) {
    if (stopping) return
    say(error instanceof StartupError ? error.message : `啟動失敗：${error.message}`)
    await stop(1)
    return
  }

  const exit = await state.backendExit
  if (stopping) return
  // 停止訊號送給整個程序群組時，後端可能比本腳本先收到 SIGTERM 並結束，這屬正常停止。
  if (exit.signal === 'SIGTERM' || exit.signal === 'SIGINT') {
    await stop(0)
    return
  }
  say(`後端程序意外結束（代碼 ${exit.code ?? exit.signal}）`)
  await stop(1)
}

await main()
