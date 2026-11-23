// 只給本機端到端腳本起的後端子程序預先載入（node --import），不改後端本身的程式。
// 子程序裡任何伺服器真的監聽成功時，把自己的 PID 與實際綁定的位址、埠寫一行 JSON 到檔案描述元 3。
// 父程序只認這條私有管道上的回報，就不會把同一個埠上別的服務當成自己起好的後端。
import { writeSync } from 'node:fs'
import net from 'node:net'
import process from 'node:process'

const REPORT_FD = 3
const listen = net.Server.prototype.listen

net.Server.prototype.listen = function listenAndReport(...args) {
  this.once('listening', () => {
    const address = this.address()
    if (address === null || typeof address !== 'object') return
    try {
      writeSync(REPORT_FD, `${JSON.stringify({ pid: process.pid, address: address.address, port: address.port })}\n`)
    } catch {
      // 父程序已關閉管道時不影響後端本身
    }
  })
  return listen.apply(this, args)
}
