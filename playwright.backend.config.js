import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { defineConfig } from '@playwright/test'
import baseConfig, { previewServer } from './playwright.config.js'
import { READY_TOKEN } from './scripts/e2e/settings.js'

// 需要後端的瀏覽器測試：除了新版測試建置，另起本機新版後端加 PostgreSQL 16 測試庫
// （scripts/e2e/backend.js，用 docker 起自己的容器）。測試檔放 e2e/backend/。
// 測試老師密碼每次執行隨機產生，經環境變數交給後端腳本與測試：設定檔先在主程序載入，
// 之後啟動的後端腳本與測試程序都繼承同一個值。
process.env.PPT_E2E_TEACHER_PASSWORD ??= randomBytes(24).toString('hex')

// 這裡列的服務會照順序一個起好才起下一個。後端腳本啟動前會確認網頁、後端、資料庫三個埠都沒人用，
// 所以後端要排在網頁前面；網頁服務之後再起，埠被占用時由 --strictPort 直接失敗。
export default defineConfig({
  ...baseConfig,
  testDir: './e2e/backend',
  testIgnore: [],
  webServer: [
    {
      name: 'api',
      command: 'node scripts/e2e/backend.js',
      wait: { stdout: new RegExp(READY_TOKEN) },
      reuseExistingServer: false,
      timeout: 180_000,
      // 送 SIGTERM 讓腳本自己停掉它啟動的後端程序與資料庫容器；逾時才強制結束。
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    },
    previewServer,
  ],
})
