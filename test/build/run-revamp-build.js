// 建置測試用：以 Vite 的 build() 跑 vite.revamp.config.js（與 vite build --config vite.revamp.config.js 相同），
// 另外把進到產物的原始模組清單寫成 JSON，讓測試直接檢查哪些原始檔進了建置，不必只靠產物裡的字串。
// 記錄模組的外掛只加在這支腳本裡，正式建置設定不變。由 revamp-build.test.js 以子程序執行：
//   node test/build/run-revamp-build.js <模式> <輸出目錄> <模組清單檔>
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const [mode, outDir, reportFile] = process.argv.slice(2)
if (!mode || !outDir || !reportFile) {
  process.stderr.write('用法：node test/build/run-revamp-build.js <模式> <輸出目錄> <模組清單檔>\n')
  process.exit(2)
}

// 產物寫出後，收集每個程式區塊包含的模組，以及每個資源檔（圖片、樣式等）的原始檔。
function recordBundledModules(modules) {
  return {
    name: 'ppt-record-bundled-modules',
    apply: 'build',
    enforce: 'post',
    writeBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        const ids = output.type === 'chunk' ? output.moduleIds : output.originalFileNames ?? []
        for (const id of ids) modules.add(id)
      }
    },
  }
}

const modules = new Set()
await build({
  configFile: fileURLToPath(new URL('../../vite.revamp.config.js', import.meta.url)),
  mode,
  logLevel: 'error',
  build: { outDir, emptyOutDir: true },
  plugins: [recordBundledModules(modules)],
})
await writeFile(reportFile, `${JSON.stringify([...modules].sort(), null, 2)}\n`)
