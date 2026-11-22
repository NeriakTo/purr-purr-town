import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'
import { BASE_PATH_ENV, resolveBasePath } from './config/base-path.js'

// 新版網頁的獨立入口：src/revamp/index.html。現行網頁仍用 vite.config.js，兩邊互不影響。
// --mode test 的建置產物放 dist-revamp-test/，其他模式（正式建置）放 dist-revamp/。兩者都不進 dist/，npm run deploy 不會發佈。
// 網址路徑與現行網頁相同規則：PPT_BASE_PATH 未設時是 /purr-purr-town/。
const fromRepo = path => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig(({ mode }) => ({
  root: fromRepo('./src/revamp/'),
  base: resolveBasePath(process.env[BASE_PATH_ENV]),
  cacheDir: fromRepo('./node_modules/.vite-revamp/'),
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: fromRepo(mode === 'test' ? './dist-revamp-test/' : './dist-revamp/'),
    emptyOutDir: true,
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1', strictPort: true },
}))
