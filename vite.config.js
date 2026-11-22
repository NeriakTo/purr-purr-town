import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'
import { BASE_PATH_ENV, resolveBasePath } from './config/base-path.js'

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  // 網址路徑：沒設時維持 GitHub Pages 的 '/purr-purr-town/'
  // （網址 https://neriakto.github.io/purr-purr-town/）。
  // 要放在別的路徑時，建置前設 PPT_BASE_PATH，例如 PPT_BASE_PATH=/ npm run build。
  base: resolveBasePath(process.env[BASE_PATH_ENV]),
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
}))
