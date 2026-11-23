import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createBackendSpawner } from '../../scripts/e2e/backend-process.js'
import { createFakeDeps, runScript } from './fake-backend-deps.js'
import { freePort, listenForeign401, loopbackAvailable } from './loopback.js'

// 用真的子程序（fixtures/fake-backend.js，行為比照 server/v2/index.js）確認：
// 就緒只認這一次起的子程序自己監聽成功；同埠上是別的服務時不會印出就緒。
// 資料庫與容器仍用假相依，不起 docker。
const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
const entry = fileURLToPath(new URL('./fixtures/fake-backend.js', import.meta.url))
const loopback = await loopbackAvailable()

function envFor(apiPort) {
  const others = [4317, 4318, 55417, 55418].filter(port => port !== apiPort)
  return {
    PPT_E2E_API_PORT: String(apiPort),
    PPT_E2E_WEB_PORT: String(others[0]),
    PPT_E2E_DB_PORT: String(others[1]),
  }
}

function startWithRealChild(apiPort, mode) {
  const fake = createFakeDeps({ waitForReady: undefined, timeouts: { database: 1000, api: 10_000, backendStop: 2000 } })
  const spawn = createBackendSpawner({ entry, cwd: fixturesDir, args: [mode], stdout: null, stderr: null })
  fake.deps.spawnBackend = env => {
    const child = spawn(env)
    fake.children.push(child)
    return child
  }
  const run = runScript({ env: envFor(apiPort), deps: fake.deps })
  return { fake, run }
}

function settle(fake, run, timeoutMs) {
  return Promise.race([
    run.exited.then(code => `結束碼 ${code}`),
    fake.ready.then(() => '印出就緒'),
    sleep(timeoutMs).then(() => '仍在等'),
  ])
}

describe.skipIf(!loopback)('本機後端腳本：用真的子程序確認就緒來自自己', () => {
  it('埠空著：自己的後端監聽成功後印就緒，停止時只停自己的後端', async () => {
    const port = await freePort()
    const { fake, run } = startWithRealChild(port, 'serve')

    expect(await settle(fake, run, 8000)).toBe('印出就緒')
    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    const [child] = fake.children
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('埠被別的服務占用（也回 401）：自己的後端綁不上而結束，不印就緒、判失敗', async () => {
    const foreign = await listenForeign401()
    try {
      const { fake, run } = startWithRealChild(foreign.port, 'serve')
      const outcome = await settle(fake, run, 8000)
      if (outcome !== '結束碼 1') {
        run.signal('SIGTERM')
        await run.exited
      }
      expect(fake.readyLines).toEqual([])
      expect(outcome).toBe('結束碼 1')
      expect(fake.messages.join('\n')).toContain('後端程序在就緒前結束')
    } finally {
      await foreign.close()
    }
  })
})
