// 本機後端腳本（scripts/e2e/backend.js）的流程本體：啟動、啟動失敗時的清理、收到結束訊號時的停止順序。
// 會碰到外部的動作（docker、暫存檔、子程序、輸出）全由呼叫端以 deps 注入，單元測試可換成假的，不必真的起 docker。
//
// deps：
//   say(message)                 進度與錯誤訊息（標準錯誤輸出）
//   printReady(line)             就緒訊息（標準輸出，瀏覽器測試靠它判斷可以開始）
//   loadServer()                 回傳 { waitForDatabase(adminUrl, ensureRunning, timeoutMs), setupDatabase(options) }
//   makeTempDir()、writeSecret(file, content)、removeDir(dir)
//   docker(args)                 執行 docker 指令，回傳 { stdout }；失敗時錯誤帶 stderr
//   randomSecret()、containerName()
//   spawnBackend(env)            起後端子程序，回傳子程序物件（pid、exitCode、signalCode、kill、'exit' 事件）
//   fetch、waitForReady、timeouts（可省略，用預設值）
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  buildBackendEnv, DATABASE_NAME, dockerRunArgs, LOOPBACK, READY_TOKEN, readE2eSettings, TEACHER_ID,
} from './settings.js'

export class StartupError extends Error {}

export const DEFAULT_TIMEOUTS = Object.freeze({ database: 60_000, api: 30_000, backendStop: 10_000 })

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

// 等後端開始回應：未登入呼叫 /api/v2/auth/session 會回 401。
export async function waitForBackendReady({ backend, settings, timeoutMs, fetch = globalThis.fetch }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isRunning(backend)) throw new StartupError('後端程序在就緒前結束')
    try {
      const response = await fetch(`${settings.apiOrigin}/api/v2/auth/session`, { method: 'POST' })
      if (response.status === 401) return
    } catch {
      // 還沒開始監聽，稍後再試
    }
    await delay(250)
  }
  throw new StartupError(`後端 ${timeoutMs / 1000} 秒內沒有就緒`)
}

export function createLifecycle({ docker, removeDir, say, timeouts = DEFAULT_TIMEOUTS }) {
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

  // 只對本次 spawn 的子程序送訊號，不依名稱或其他 PID 停程序。
  async function stopBackend() {
    const { backend } = state
    if (!backend || !isRunning(backend)) return
    backend.kill('SIGTERM')
    const exited = await Promise.race([state.backendExit.then(() => true), delay(timeouts.backendStop, false)])
    if (!exited) {
      say(`後端程序 ${backend.pid} 沒有在時限內結束，強制停止`)
      backend.kill('SIGKILL')
      await state.backendExit
    }
  }

  // 只移除本次建立的容器：有容器編號用編號，docker run 被中斷時用本次產生的唯一名稱。
  // 容器已不存在（docker run 沒成功、或資料庫自己停了而被 --rm 自動移除）時目的已達成，不算失敗。
  async function removeContainer() {
    if (state.dockerRun) await state.dockerRun.catch(() => {})
    const target = state.containerId ?? state.containerName
    if (!target) return
    try {
      await docker(['rm', '--force', target])
      say('已移除本次建立的資料庫容器')
    } catch (error) {
      if (/no such container/i.test(error.stderr ?? '')) return
      say(`移除資料庫容器失敗，請手動執行 docker rm --force ${target}：${error.stderr?.trim() || error.message}`)
    }
  }

  function cleanup() {
    state.stopping = true
    cleaning ??= (async () => {
      await stopBackend().catch(error => say(`停止後端程序失敗：${error.message}`))
      await removeContainer()
      if (state.tempDir) await removeDir(state.tempDir).catch(() => {})
    })()
    return cleaning
  }

  return { state, cleanup }
}

function watchExit(child) {
  return new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
}

export async function startStack(settings, { state, deps, env }) {
  const { say } = deps
  const timeouts = deps.timeouts ?? DEFAULT_TIMEOUTS
  const waitForReady = deps.waitForReady ?? waitForBackendReady
  const ensureRunning = () => {
    if (state.stopping) throw new StartupError('已要求停止')
  }

  const server = await deps.loadServer()
  state.tempDir = await deps.makeTempDir()
  const postgresPassword = deps.randomSecret()
  const webPassword = deps.randomSecret()
  let teacherPassword = env.PPT_E2E_TEACHER_PASSWORD
  if (!teacherPassword) {
    teacherPassword = deps.randomSecret()
    const passwordFile = join(state.tempDir, 'teacher-password')
    await deps.writeSecret(passwordFile, teacherPassword + '\n')
    say(`測試老師密碼已寫入 ${passwordFile}（停止時刪除）`)
  }

  const envFile = join(state.tempDir, 'postgres.env')
  await deps.writeSecret(envFile, `POSTGRES_PASSWORD=${postgresPassword}\n`)
  const containerName = deps.containerName()
  ensureRunning()
  say(`啟動資料庫容器 ${containerName}（${settings.postgresImage}，127.0.0.1:${settings.dbPort}）`)
  try {
    state.containerName = containerName
    state.dockerRun = deps.docker(dockerRunArgs(settings, { containerName, envFile }))
    const { stdout } = await state.dockerRun
    state.containerId = stdout.trim()
  } catch (error) {
    ensureRunning()
    throw new StartupError(`無法啟動資料庫容器（docker 是否可用、映像 ${settings.postgresImage} 是否已在本機、埠 ${settings.dbPort} 是否被占用）：${error.stderr?.trim() || error.message}`)
  }
  ensureRunning()

  const adminUrl = `postgresql://postgres:${postgresPassword}@${LOOPBACK}:${settings.dbPort}/postgres`
  await server.waitForDatabase(adminUrl, ensureRunning, timeouts.database)
  ensureRunning()
  say('建立測試庫與測試老師')
  await server.setupDatabase({
    adminUrl,
    database: DATABASE_NAME,
    webPassword,
    teacherId: TEACHER_ID,
    teacherName: settings.teacherName,
    demoPassword: teacherPassword,
  })

  ensureRunning()
  say(`啟動新版後端（${settings.apiOrigin}）`)
  const backend = deps.spawnBackend(buildBackendEnv(settings, { webPassword, database: DATABASE_NAME, parentEnv: env }))
  state.backend = backend
  state.backendExit = watchExit(backend)
  await waitForReady({ backend, backendExit: state.backendExit, settings, timeoutMs: timeouts.api, fetch: deps.fetch })

  deps.printReady(`${READY_TOKEN} api=${settings.apiOrigin} web=${settings.webOrigin} teacher=${settings.teacherName}`)
  say(`就緒，後端程序 PID ${backend.pid}；按 Ctrl+C 停止`)
}

// 腳本主流程。onSignal(name, handler) 登記結束訊號處理；exit(code) 結束整個腳本。
export async function runBackendScript({ env, deps, onSignal, exit }) {
  let settings
  try {
    settings = readE2eSettings(env)
  } catch (error) {
    deps.say(error.message)
    exit(1)
    return
  }

  const { state, cleanup } = createLifecycle(deps)
  let stopping = false
  const stop = async code => {
    if (stopping) return
    stopping = true
    await cleanup()
    exit(code)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    onSignal(signal, () => {
      deps.say(`收到 ${signal}，停止中`)
      stop(0)
    })
  }

  try {
    await startStack(settings, { state, deps, env })
  } catch (error) {
    if (stopping) return
    deps.say(error instanceof StartupError ? error.message : `啟動失敗：${error.message}`)
    await stop(1)
    return
  }

  const exitInfo = await state.backendExit
  if (stopping) return
  // 停止訊號送給整個程序群組時，後端可能比本腳本先收到 SIGTERM 並結束，這屬正常停止。
  if (exitInfo.signal === 'SIGTERM' || exitInfo.signal === 'SIGINT') {
    await stop(0)
    return
  }
  deps.say(`後端程序意外結束（代碼 ${exitInfo.code ?? exitInfo.signal}）`)
  await stop(1)
}
