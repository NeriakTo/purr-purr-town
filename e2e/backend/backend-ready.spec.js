import process from 'node:process'
import { expect, test } from '@playwright/test'
import { readE2eSettings } from '../../scripts/e2e/settings.js'

// 本機後端與測試庫由 playwright.backend.config.js 啟動的 scripts/e2e/backend.js 提供。
const settings = readE2eSettings(process.env)
const loginUrl = `${settings.apiOrigin}/api/v2/auth/login`
const credentials = { name: settings.teacherName, passcode: process.env.PPT_E2E_TEACHER_PASSWORD }

test('測試老師可從測試網頁的來源登入本機後端', async ({ request }) => {
  expect(credentials.passcode).toBeTruthy()
  const response = await request.post(loginUrl, { data: credentials, headers: { origin: settings.webOrigin } })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.token).toMatch(/^[0-9a-f]{64}$/)
  expect(body.teacher.name).toBe(settings.teacherName)
})

test('密碼錯誤時回 LOGIN_FAILED', async ({ request }) => {
  const response = await request.post(loginUrl, { data: { ...credentials, passcode: 'wrong-passcode' } })
  expect(response.status()).toBe(401)
  expect((await response.json()).error.code).toBe('LOGIN_FAILED')
})

test('其他來源被擋下', async ({ request }) => {
  const response = await request.post(loginUrl, { data: credentials, headers: { origin: 'http://127.0.0.1:1' } })
  expect(response.status()).toBe(403)
  expect((await response.json()).error.code).toBe('ORIGIN_FORBIDDEN')
})
