// 單元測試用的假後端，只由 test/e2e-support 的測試經 createBackendSpawner 啟動。
// 照 server/v2/index.js 的方式讀 PPT_V2_HOST、PPT_V2_PORT 監聽，監聽失敗就以代碼 1 結束；
// 對 POST /api/v2/auth/session 回 401，與真的後端在未登入時相同。
// 第一個參數是模式：serve（預設）監聽；idle 不監聽也不結束；exit 立刻以代碼 3 結束。
import http from 'node:http'
import process from 'node:process'

const mode = process.argv[2] ?? 'serve'

if (mode === 'exit') {
  process.exit(3)
} else if (mode === 'idle') {
  setInterval(() => {}, 60_000)
} else {
  const server = http.createServer((request, response) => {
    response.statusCode = request.method === 'POST' && request.url === '/api/v2/auth/session' ? 401 : 404
    response.end()
  })
  server.once('error', () => {
    process.exitCode = 1
  })
  server.listen({ host: process.env.PPT_V2_HOST, port: Number(process.env.PPT_V2_PORT) })
}
