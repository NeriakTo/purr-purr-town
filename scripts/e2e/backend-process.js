// 起本機後端子程序。entry 是後端入口檔，env 由呼叫端組好（只含後端需要的變數）。
// 子程序的標準輸出與錯誤轉給 stdout、stderr；給 null 時直接丟棄。
import { spawn } from 'node:child_process'
import process from 'node:process'

export function createBackendSpawner({ entry, cwd, args = [], stdout = process.stdout, stderr = process.stderr }) {
  return env => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
