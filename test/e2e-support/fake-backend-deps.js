// 本機後端腳本流程測試共用的假相依：不起 docker、不建暫存目錄、不起真的子程序，
// 只把每個對外動作依序記下來，讓測試檢查啟動、清理與停止的順序與對象。
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { runBackendScript } from '../../scripts/e2e/backend-lifecycle.js'

export const OWN_CONTAINER_ID = 'own-container-id'
export const OWN_CONTAINER_NAME = 'ppt-e2e-own'
export const FAKE_TEMP_DIR = '/fake/ppt-e2e-backend-test'

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

export function dockerError(stderr) {
  return Object.assign(new Error('Command failed: docker'), { stderr })
}

// 假的後端子程序：記下收到的訊號，預設收到 SIGTERM 或 SIGKILL 就結束。
// stdio[3] 是子程序回報監聽位址的管道，測試可用 announce() 模擬子程序回報。
export class FakeChild extends EventEmitter {
  constructor({ pid = 4242, ignoreSigterm = false, record = () => {} } = {}) {
    super()
    this.pid = pid
    this.exitCode = null
    this.signalCode = null
    this.signals = []
    this.ignoreSigterm = ignoreSigterm
    this.record = record
    this.stdio = [null, null, null, new PassThrough()]
  }

  kill(signal) {
    this.signals.push(signal)
    this.record(['kill', this.pid, signal])
    if (signal === 'SIGTERM' && this.ignoreSigterm) return true
    setImmediate(() => this.finish(null, signal))
    return true
  }

  finish(code, signal) {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.stdio[3].end()
    this.emit('exit', code, signal)
  }

  announce(report) {
    this.stdio[3].write(`${JSON.stringify(report)}\n`)
  }
}

export function createFakeDeps(overrides = {}) {
  const calls = []
  const messages = []
  const readyLines = []
  const children = []
  const ready = deferred()
  const record = call => calls.push(call)

  const deps = {
    say: message => messages.push(message),
    printReady: line => {
      readyLines.push(line)
      record(['ready'])
      ready.resolve(line)
    },
    // 預設當成三個埠都空著；檢查埠本身的測試在 ports.test.js 與 backend-ready.test.js。
    checkPorts: async () => {},
    loadServer: async () => ({
      waitForDatabase: async () => record(['waitForDatabase']),
      setupDatabase: async options => record(['setupDatabase', options.database]),
    }),
    makeTempDir: async () => {
      record(['makeTempDir'])
      return FAKE_TEMP_DIR
    },
    writeSecret: async file => record(['writeSecret', file]),
    removeDir: async dir => record(['removeDir', dir]),
    docker: async args => {
      record(['docker', ...args])
      return { stdout: args[0] === 'run' ? `${OWN_CONTAINER_ID}\n` : '' }
    },
    randomSecret: () => 'fake-secret',
    containerName: () => OWN_CONTAINER_NAME,
    spawnBackend: env => {
      const child = new FakeChild({ pid: 4242 + children.length, record })
      children.push(child)
      record(['spawnBackend', env.PPT_V2_HOST, env.PPT_V2_PORT])
      return child
    },
    waitForReady: async () => record(['waitForReady']),
    timeouts: { database: 1000, api: 1000, backendStop: 50 },
    ...overrides,
  }

  return {
    deps,
    calls,
    messages,
    readyLines,
    children,
    ready: ready.promise,
    record,
    actions: () => calls.map(call => call[0]),
    dockerCommands: () => calls.filter(call => call[0] === 'docker').map(call => call.slice(1)),
  }
}

// 跑一次腳本流程：訊號處理與結束都換成測試可控制的版本。
export function runScript({ env = {}, deps }) {
  const handlers = new Map()
  const exits = []
  const exited = deferred()
  const done = runBackendScript({
    env,
    deps,
    onSignal: (name, handler) => handlers.set(name, handler),
    exit: code => {
      exits.push(code)
      exited.resolve(code)
    },
  })
  return {
    done,
    exited: exited.promise,
    exits,
    signal: name => handlers.get(name)(),
  }
}
