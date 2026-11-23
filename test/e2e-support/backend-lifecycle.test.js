import { describe, expect, it } from 'vitest'
import { READY_TOKEN } from '../../scripts/e2e/settings.js'
import {
  createFakeDeps,
  deferred,
  dockerError,
  FAKE_TEMP_DIR,
  FakeChild,
  OWN_CONTAINER_ID,
  OWN_CONTAINER_NAME,
  runScript,
} from './fake-backend-deps.js'

// scripts/e2e/backend.js 的流程本體：啟動、失敗清理、收到結束訊號時的停止順序。
// 全部用假相依，不起 docker、不起真的後端。
const STARTUP_ACTIONS = [
  'makeTempDir', 'writeSecret', 'writeSecret', 'docker', 'waitForDatabase', 'setupDatabase', 'spawnBackend', 'waitForReady', 'ready',
]
const OWN_REMOVE = ['rm', '--force', OWN_CONTAINER_ID]

function expectOnlyOwnDockerCommands(fake, removeTarget = OWN_CONTAINER_ID) {
  const commands = fake.dockerCommands()
  expect(commands[0][0]).toBe('run')
  expect(commands[0]).toContain(OWN_CONTAINER_NAME)
  expect(commands.slice(1)).toEqual([['rm', '--force', removeTarget]])
}

describe('本機後端腳本：啟動', () => {
  it('依序建暫存目錄、起容器、等資料庫、建庫、起後端，就緒後印一行就緒訊息', async () => {
    const fake = createFakeDeps()
    const run = runScript({ deps: fake.deps })
    const line = await fake.ready

    expect(fake.actions()).toEqual(STARTUP_ACTIONS)
    expect(line.startsWith(`${READY_TOKEN} api=http://127.0.0.1:`)).toBe(true)
    expect(fake.calls.find(call => call[0] === 'spawnBackend')[1]).toBe('127.0.0.1')
    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
  })

  it('環境變數不對時什麼都不啟動，結束碼 1', async () => {
    const fake = createFakeDeps()
    const run = runScript({ env: { PPT_E2E_API_PORT: 'abc' }, deps: fake.deps })
    expect(await run.exited).toBe(1)
    expect(fake.calls).toEqual([])
    expect(fake.messages.join('\n')).toContain('PPT_E2E_API_PORT')
  })
})

describe('本機後端腳本：啟動到一半失敗', () => {
  it('建庫失敗（容器已起）：移除本次容器、刪暫存目錄、不起後端、不印就緒', async () => {
    const fake = createFakeDeps({
      loadServer: async () => ({
        waitForDatabase: async () => {},
        setupDatabase: async () => { throw new Error('建庫失敗') },
      }),
    })
    const run = runScript({ deps: fake.deps })

    expect(await run.exited).toBe(1)
    expect(fake.actions()).not.toContain('spawnBackend')
    expect(fake.readyLines).toEqual([])
    expectOnlyOwnDockerCommands(fake)
    expect(fake.calls.at(-1)).toEqual(['removeDir', FAKE_TEMP_DIR])
    expect(fake.messages.join('\n')).toContain('建庫失敗')
  })

  it('後端起了但沒有就緒：停掉本次的後端程序、移除本次容器、刪暫存目錄', async () => {
    const fake = createFakeDeps({
      waitForReady: async () => { throw new Error('沒有就緒') },
    })
    const run = runScript({ deps: fake.deps })

    expect(await run.exited).toBe(1)
    expect(fake.readyLines).toEqual([])
    expect(fake.children).toHaveLength(1)
    expect(fake.children[0].signals).toEqual(['SIGTERM'])
    const afterSpawn = fake.calls.slice(fake.actions().indexOf('spawnBackend') + 1)
    expect(afterSpawn).toEqual([
      ['kill', fake.children[0].pid, 'SIGTERM'],
      ['docker', ...OWN_REMOVE],
      ['removeDir', FAKE_TEMP_DIR],
    ])
  })

  it('docker run 失敗：用本次產生的名稱嘗試移除，「沒有這個容器」不算錯', async () => {
    const fake = createFakeDeps({
      docker: async args => {
        fake.record(['docker', ...args])
        if (args[0] === 'run') throw dockerError('port is already allocated')
        throw dockerError(`Error response from daemon: No such container: ${OWN_CONTAINER_NAME}\n`)
      },
    })
    const run = runScript({ deps: fake.deps })

    expect(await run.exited).toBe(1)
    expectOnlyOwnDockerCommands(fake, OWN_CONTAINER_NAME)
    expect(fake.actions()).not.toContain('waitForDatabase')
    expect(fake.calls.at(-1)).toEqual(['removeDir', FAKE_TEMP_DIR])
    const output = fake.messages.join('\n')
    expect(output).toContain('無法啟動資料庫容器')
    expect(output).not.toContain('移除資料庫容器失敗')
  })
})

describe('本機後端腳本：停止', () => {
  it('收到 SIGTERM：先停自己的後端並等它結束，再移除自己的容器，最後刪暫存目錄，結束碼 0', async () => {
    const fake = createFakeDeps()
    const run = runScript({ deps: fake.deps })
    await fake.ready
    const readyAt = fake.calls.length

    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    await run.done

    const child = fake.children[0]
    expect(fake.calls.slice(readyAt)).toEqual([
      ['kill', child.pid, 'SIGTERM'],
      ['docker', ...OWN_REMOVE],
      ['removeDir', FAKE_TEMP_DIR],
    ])
    expect(child.signals).toEqual(['SIGTERM'])
    expectOnlyOwnDockerCommands(fake)
  })

  it('連續收到多次結束訊號只清理一次、只結束一次', async () => {
    const fake = createFakeDeps()
    const run = runScript({ deps: fake.deps })
    await fake.ready

    run.signal('SIGTERM')
    run.signal('SIGINT')
    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    await run.done

    expect(run.exits).toEqual([0])
    expect(fake.children[0].signals).toEqual(['SIGTERM'])
    expectOnlyOwnDockerCommands(fake)
  })

  it('後端不理 SIGTERM：逾時後只對自己的後端程序補送 SIGKILL', async () => {
    const fake = createFakeDeps()
    fake.deps.spawnBackend = env => {
      fake.record(['spawnBackend', env.PPT_V2_HOST, env.PPT_V2_PORT])
      const child = new FakeChild({ ignoreSigterm: true, record: fake.record })
      fake.children.push(child)
      return child
    }
    const run = runScript({ deps: fake.deps })
    await fake.ready

    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    const child = fake.children[0]
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(fake.messages.join('\n')).toContain('強制停止')
    expectOnlyOwnDockerCommands(fake)
  })

  it('等 docker run 時收到 SIGTERM：docker run 沒成功就用本次名稱移除，之後的步驟都不做', async () => {
    const dockerRun = deferred()
    const fake = createFakeDeps({
      docker: async args => {
        fake.record(['docker', ...args])
        if (args[0] === 'run') return dockerRun.promise
        throw dockerError(`Error response from daemon: No such container: ${OWN_CONTAINER_NAME}\n`)
      },
    })
    const run = runScript({ deps: fake.deps })
    await waitUntil(() => fake.actions().includes('docker'))

    run.signal('SIGTERM')
    dockerRun.reject(dockerError('context canceled'))
    expect(await run.exited).toBe(0)
    await run.done

    expectOnlyOwnDockerCommands(fake, OWN_CONTAINER_NAME)
    expect(fake.actions()).not.toContain('waitForDatabase')
    expect(fake.actions()).not.toContain('spawnBackend')
    expect(fake.messages.join('\n')).not.toContain('移除資料庫容器失敗')
  })

  it('等 docker run 時收到 SIGTERM：docker run 之後才完成，就用它回傳的容器編號移除', async () => {
    const dockerRun = deferred()
    const fake = createFakeDeps({
      docker: async args => {
        fake.record(['docker', ...args])
        return args[0] === 'run' ? dockerRun.promise : { stdout: '' }
      },
    })
    const run = runScript({ deps: fake.deps })
    await waitUntil(() => fake.actions().includes('docker'))

    run.signal('SIGTERM')
    dockerRun.resolve({ stdout: `${OWN_CONTAINER_ID}\n` })
    expect(await run.exited).toBe(0)
    await run.done

    expectOnlyOwnDockerCommands(fake)
    expect(fake.actions()).not.toContain('waitForDatabase')
    expect(fake.actions()).not.toContain('spawnBackend')
  })

  it('容器已經不存在（例如資料庫自己停了、帶 --rm 被自動移除）時不當成移除失敗', async () => {
    const fake = createFakeDeps({
      docker: async args => {
        fake.record(['docker', ...args])
        if (args[0] === 'run') return { stdout: `${OWN_CONTAINER_ID}\n` }
        throw dockerError(`Error response from daemon: No such container: ${OWN_CONTAINER_ID}\n`)
      },
    })
    const run = runScript({ deps: fake.deps })
    await fake.ready

    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    expectOnlyOwnDockerCommands(fake)
    expect(fake.messages.join('\n')).not.toContain('移除資料庫容器失敗')
    expect(fake.calls.at(-1)).toEqual(['removeDir', FAKE_TEMP_DIR])
  })

  it('其他原因移除容器失敗時，提示手動移除本次的容器編號', async () => {
    const fake = createFakeDeps({
      docker: async args => {
        fake.record(['docker', ...args])
        if (args[0] === 'run') return { stdout: `${OWN_CONTAINER_ID}\n` }
        throw dockerError('Cannot connect to the Docker daemon')
      },
    })
    const run = runScript({ deps: fake.deps })
    await fake.ready

    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
    expect(fake.messages.join('\n')).toContain(`移除資料庫容器失敗，請手動執行 docker rm --force ${OWN_CONTAINER_ID}`)
  })

  it('後端意外結束：清掉容器與暫存目錄，結束碼 1', async () => {
    const fake = createFakeDeps()
    const run = runScript({ deps: fake.deps })
    await fake.ready

    fake.children[0].finish(1, null)
    expect(await run.exited).toBe(1)
    expect(fake.messages.join('\n')).toContain('意外結束')
    expectOnlyOwnDockerCommands(fake)
    expect(fake.calls.at(-1)).toEqual(['removeDir', FAKE_TEMP_DIR])
  })

  it('後端比腳本先收到群組的 SIGTERM 而結束：視為正常停止，結束碼 0', async () => {
    const fake = createFakeDeps()
    const run = runScript({ deps: fake.deps })
    await fake.ready

    fake.children[0].finish(null, 'SIGTERM')
    expect(await run.exited).toBe(0)
    expectOnlyOwnDockerCommands(fake)
  })
})

async function waitUntil(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('等待條件逾時')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
