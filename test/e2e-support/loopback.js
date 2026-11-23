// 需要真的在 127.0.0.1 開埠的測試共用的小工具。
import http from 'node:http'
import net from 'node:net'

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

function close(server) {
  return new Promise(resolve => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

// 有些沙箱不准開本機連線埠；只有這種權限錯誤才回 false 讓測試略過，其他錯誤照常拋出。
export async function loopbackAvailable() {
  const server = net.createServer()
  try {
    await listen(server)
    await close(server)
    return true
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      console.warn(`LOOPBACK-SKIP: 這個環境不准在 127.0.0.1 開埠（${error.code}），略過需要真的開埠的測試`)
      return false
    }
    throw error
  }
}

// 模擬機器上已經在跑的別的後端：任何請求都回 401。
export async function listenForeign401() {
  const server = http.createServer((request, response) => {
    response.statusCode = 401
    response.end()
  })
  await listen(server)
  return { port: server.address().port, close: () => close(server) }
}

// 取一個目前沒人用的埠（開了馬上關）。
export async function freePort() {
  const server = await listen(net.createServer())
  const { port } = server.address()
  await close(server)
  return port
}
