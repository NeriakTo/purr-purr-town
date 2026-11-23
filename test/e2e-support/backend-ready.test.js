import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PORTS } from '../../scripts/e2e/settings.js'
import { createFakeDeps, runScript } from './fake-backend-deps.js'

// 就緒判斷必須確認回應來自這一次自己起的後端子程序：同一個埠上若是機器上別的後端（一樣回 401），
// 測試請求就會打到別人的後端與資料庫。這裡用假子程序與假 fetch，不開真的埠。
const API_PORT = DEFAULT_PORTS.api
const HOST = '127.0.0.1'
const respond401 = async () => ({ status: 401 })
const runs = []

function start(overrides) {
  const fake = createFakeDeps({ waitForReady: undefined, fetch: respond401, ...overrides })
  const run = runScript({ deps: fake.deps })
  runs.push(run)
  return { fake, run }
}

async function untilChildSpawned(fake) {
  const deadline = Date.now() + 2000
  while (fake.children.length === 0) {
    if (Date.now() > deadline) throw new Error('兩秒內沒有起後端子程序')
    await sleep(5)
  }
  return fake.children[0]
}

// 等到腳本結束、印出就緒，或逾時，三者先到者為準。
function settle(fake, run, timeoutMs) {
  return Promise.race([
    run.exited.then(code => `結束碼 ${code}`),
    fake.ready.then(() => '印出就緒'),
    sleep(timeoutMs).then(() => '仍在等'),
  ])
}

afterEach(async () => {
  // 沒有正常結束的流程（例如修正前誤判就緒）由這裡送結束訊號收掉
  for (const run of runs.splice(0)) {
    if (run.exits.length === 0) run.signal('SIGTERM')
    await Promise.race([run.exited, sleep(1000)])
  }
})

describe('本機後端腳本：啟動前確認埠沒人用', () => {
  it('檢查埠失敗時什麼都不啟動：不建暫存目錄、不起容器、不起後端，錯誤原樣告知', async () => {
    const { fake, run } = start({
      checkPorts: async () => { throw new Error('埠 3317（後端）在 127.0.0.1 上已有程式在監聽') },
    })
    fake.deps.loadServer = async () => {
      fake.record(['loadServer'])
      return { waitForDatabase: async () => {}, setupDatabase: async () => {} }
    }

    expect(await settle(fake, run, 2000)).toBe('結束碼 1')
    expect(fake.calls).toEqual([])
    expect(fake.messages.join('\n')).toContain('埠 3317（後端）在 127.0.0.1 上已有程式在監聽')
  })
})

describe('本機後端腳本：就緒必須來自自己起的後端', () => {
  it('埠上別的服務回 401、自己的後端沒有回報監聽成功：不印就緒，逾時判失敗並清理', async () => {
    const { fake, run } = start({ timeouts: { database: 1000, api: 300, backendStop: 50 } })

    expect(await settle(fake, run, 2000)).toBe('結束碼 1')
    expect(fake.readyLines).toEqual([])
    expect(fake.children[0].signals).toEqual(['SIGTERM'])
    expect(fake.calls.at(-1)[0]).toBe('removeDir')
    expect(fake.messages.join('\n')).toContain('沒有就緒')
  })

  it('監聽回報不是自己的（埠不同或 PID 不同）不算數', async () => {
    const { fake, run } = start({ timeouts: { database: 1000, api: 300, backendStop: 50 } })
    const child = await untilChildSpawned(fake)
    child.announce({ pid: child.pid, address: HOST, port: API_PORT + 1 })
    child.announce({ pid: child.pid + 1000, address: HOST, port: API_PORT })
    child.announce({ pid: child.pid, address: '0.0.0.0', port: API_PORT })
    child.stdio[3].write('不是 JSON 的雜訊\n')

    expect(await settle(fake, run, 2000)).toBe('結束碼 1')
    expect(fake.readyLines).toEqual([])
  })

  it('自己的後端回報監聽成功之前不送任何請求；回報之後確認 401 才印就緒', async () => {
    const requests = []
    const { fake, run } = start({
      fetch: async url => {
        requests.push(url)
        return { status: 401 }
      },
    })
    const child = await untilChildSpawned(fake)
    await sleep(300)
    expect(requests).toEqual([])
    expect(fake.readyLines).toEqual([])

    // 回報分兩段寫進管道，確認逐行組回來判斷
    const line = JSON.stringify({ pid: child.pid, address: HOST, port: API_PORT })
    child.stdio[3].write(line.slice(0, 10))
    await sleep(20)
    child.stdio[3].write(`${line.slice(10)}\n`)

    expect(await settle(fake, run, 2000)).toBe('印出就緒')
    expect(requests).toEqual([`http://${HOST}:${API_PORT}/api/v2/auth/session`])
    run.signal('SIGTERM')
    expect(await run.exited).toBe(0)
  })

  it('子程序提前結束：立刻判失敗並清理，不繼續等（即使埠上的服務不回應）', async () => {
    const { fake, run } = start({
      fetch: () => new Promise(() => {}),
      timeouts: { database: 1000, api: 20_000, backendStop: 50 },
    })
    const child = await untilChildSpawned(fake)
    const startedAt = Date.now()
    child.finish(1, null)

    expect(await settle(fake, run, 1500)).toBe('結束碼 1')
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(fake.readyLines).toEqual([])
    expect(fake.messages.join('\n')).toContain('後端程序在就緒前結束')
    expect(fake.dockerCommands().at(-1)).toEqual(['rm', '--force', 'own-container-id'])
  })

  it('回報監聽成功後，埠上的服務不回應：子程序結束時立刻判失敗', async () => {
    const { fake, run } = start({
      fetch: () => new Promise(() => {}),
      timeouts: { database: 1000, api: 20_000, backendStop: 50 },
    })
    const child = await untilChildSpawned(fake)
    child.announce({ pid: child.pid, address: HOST, port: API_PORT })
    await sleep(50)
    child.finish(1, null)

    expect(await settle(fake, run, 1500)).toBe('結束碼 1')
    expect(fake.readyLines).toEqual([])
  })
})
