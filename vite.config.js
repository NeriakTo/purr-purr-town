import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 修改這裡：請完全依照您的 GitHub Repository 名稱
  // 您的網址是 https://neriakto.github.io/purr-purr-town/
  // 所以這裡要填 '/purr-purr-town/'
  base: '/purr-purr-town/', 
})