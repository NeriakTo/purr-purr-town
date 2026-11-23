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
// 流程本體在 backend-lifecycle.js（可注入相依、有單元測試），這裡只接上真的 docker、檔案與子程序。
import { execFile } from 'node:child_process'
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
import { runBackendScript, StartupError } from './backend-lifecycle.js'
import { createBackendSpawner } from './backend-process.js'

const run = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const serverDir = join(repoRoot, 'server')

const say = message => process.stderr.write(`[e2e 後端] ${message}\n`)

function randomSecret() {
  return randomBytes(24).toString('hex')
}

async function waitForDatabase(pg, adminUrl, ensureRunning, timeoutMs) {
  const deadline = Date.now() + timeoutMs
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
  throw new StartupError(`測試庫 ${timeoutMs / 1000} 秒內沒有就緒`)
}

async function loadServer() {
  if (!existsSync(join(serverDir, 'node_modules', 'pg'))) {
    throw new StartupError('server/ 還沒安裝套件，請先在 server/ 執行 npm ci')
  }
  const pg = createRequire(join(serverDir, 'package.json'))('pg')
  const { setupDatabase } = await import('../../server/test-env/setup.js')
  return {
    waitForDatabase: (adminUrl, ensureRunning, timeoutMs) => waitForDatabase(pg, adminUrl, ensureRunning, timeoutMs),
    setupDatabase,
  }
}

const deps = {
  say,
  printReady: line => process.stdout.write(`${line}\n`),
  loadServer,
  makeTempDir: () => mkdtemp(join(tmpdir(), 'ppt-e2e-backend-')),
  writeSecret: (file, content) => writeFile(file, content, { mode: 0o600 }),
  removeDir: dir => rm(dir, { recursive: true, force: true }),
  docker: args => run('docker', args),
  randomSecret,
  containerName: () => `ppt-e2e-${randomBytes(4).toString('hex')}`,
  spawnBackend: createBackendSpawner({ entry: join(serverDir, 'v2', 'index.js'), cwd: serverDir }),
}

await runBackendScript({
  env: process.env,
  deps,
  onSignal: (name, handler) => process.on(name, handler),
  exit: code => process.exit(code),
})
