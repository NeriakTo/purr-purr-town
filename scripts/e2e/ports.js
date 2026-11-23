// 本機後端腳本啟動前確認網頁、後端、資料庫三個埠在 127.0.0.1 上都沒人監聽。
// 有人在用就直接報錯，不啟動任何東西，避免測試請求打到機器上既有的服務與資料庫。
import net from 'node:net'
import { LOOPBACK } from './settings.js'

const PORTS = [
  { key: 'webPort', label: '網頁', env: 'PPT_E2E_WEB_PORT' },
  { key: 'apiPort', label: '後端', env: 'PPT_E2E_API_PORT' },
  { key: 'dbPort', label: '資料庫', env: 'PPT_E2E_DB_PORT' },
]
const PROBE_TIMEOUT_MS = 1000

function tryConnect(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const finish = outcome => {
      socket.destroy()
      resolve(outcome)
    }
    socket.setTimeout(timeoutMs, () => finish({ inUse: true, reason: `${timeoutMs} 毫秒內連線沒有結果，無法確認沒人用` }))
    socket.once('connect', () => finish({ inUse: true, reason: '已有程式接受連線' }))
    socket.once('error', error => finish(
      error.code === 'ECONNREFUSED' ? { inUse: false } : { inUse: true, reason: `無法確認（${error.code ?? error.message}）` },
    ))
  })
}

function tryBind(host, port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', error => resolve(
      error.code === 'EADDRINUSE' ? { inUse: true, reason: '埠已被綁定' } : { inUse: true, reason: `無法確認（${error.code ?? error.message}）` },
    ))
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve({ inUse: false })))
  })
}

// 連得上代表有人在監聽；連不上再試著綁一次，綁不上也算被占用。只有兩者都確定空著才回 inUse: false。
export async function probePort(port, { host = LOOPBACK, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const connected = await tryConnect(host, port, timeoutMs)
  if (connected.inUse) return connected
  return tryBind(host, port)
}

export async function assertPortsFree(settings, { probe = probePort } = {}) {
  const results = await Promise.all(PORTS.map(async entry => {
    const port = settings[entry.key]
    try {
      return { ...entry, port, ...(await probe(port)) }
    } catch (error) {
      return { ...entry, port, inUse: true, reason: `無法確認（${error.message}）` }
    }
  }))
  const busy = results.filter(result => result.inUse)
  if (busy.length === 0) return

  const lines = busy.map(({ label, port, env, reason }) => (
    `  ${label} ${LOOPBACK}:${port}（${reason}）：停掉占用的程式，或改用沒人用的埠，例如 ${env}=<其他埠>`
  ))
  throw new Error([
    `下列的埠在 ${LOOPBACK} 上已有程式在用，為避免測試打到別的服務與資料庫，什麼都沒有啟動：`,
    ...lines,
    '瀏覽器測試與本機後端讀同一組環境變數，改了埠兩邊會一起生效。',
  ].join('\n'))
}
