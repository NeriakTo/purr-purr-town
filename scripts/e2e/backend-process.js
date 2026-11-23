// 起本機後端子程序。entry 是後端入口檔，env 由呼叫端組好（只含後端需要的變數）。
// 子程序預先載入 listen-report.js：監聽成功時把自己的 PID 與綁定的位址寫到第 4 個串流（stdio[3]），
// 父程序據此確認埠是這個子程序自己綁的。
// 子程序的標準輸出與錯誤轉給 stdout、stderr；給 null 時直接丟棄。
import { spawn } from 'node:child_process'
import process from 'node:process'

const LISTEN_REPORT = new URL('./listen-report.js', import.meta.url).href

export function createBackendSpawner({ entry, cwd, args = [], stdout = process.stdout, stderr = process.stderr }) {
  return env => {
    const child = spawn(process.execPath, ['--import', LISTEN_REPORT, entry, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    })
    forward(child.stdout, stdout)
    forward(child.stderr, stderr)
    return child
  }
}

function forward(source, target) {
  if (target) source.pipe(target, { end: false })
  else source.resume()
}
