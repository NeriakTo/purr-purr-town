import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 設定 base 路徑，讓 GitHub Pages 能正確讀取資源
  // 注意：如果您將來 GitHub Repository 改名，這裡也要跟著改
  // 這裡我們使用 './' (相對路徑) 這是最安全的懶人設定法，
  // 這樣無論您的專案叫什麼名字，它通常都能運作。
  base: './', 
})