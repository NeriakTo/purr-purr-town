import process from 'node:process'
import { defineConfig } from '@playwright/test'
import { readE2eSettings } from './scripts/e2e/settings.js'

// 瀏覽器測試：先做新版的測試建置（含只供測試的操作入口），再用 vite preview 只綁 127.0.0.1 提供。
// 埠可用 PPT_E2E_WEB_PORT 改（其他可設項目見 scripts/e2e/settings.js）；被占用時直接失敗，不沿用別人的服務。
// 瀏覽器用本機快取的 Chromium（@playwright/test 1.64.1 對應 1248），不另下載。
// 需要後端的測試放 e2e/backend/，用 playwright.backend.config.js 跑（npm run test:e2e:backend）。
const settings = readE2eSettings(process.env)
export const webOrigin = settings.webOrigin

export const previewServer = {
  name: 'web',
  command: `npm run build:revamp:test && npm run preview:revamp:test -- --port ${settings.webPort}`,
  url: `${webOrigin}/`,
  env: { PPT_BASE_PATH: '/' },
  reuseExistingServer: false,
  timeout: 120_000,
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  testIgnore: 'backend/**',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `${webOrigin}/`,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: previewServer,
})
