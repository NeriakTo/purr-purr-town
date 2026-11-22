import { expect, test } from '@playwright/test'

// 新版入口頁的佔位標題；入口頁改版時一起改。
const PLACEHOLDER_HEADING = '呼嚕嚕小鎮新版'

async function openEntry(context, pageErrors) {
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PLACEHOLDER_HEADING)
  await page.waitForFunction(() => Boolean(window.__pptTest?.idbProbe))
  return page
}

test('經測試入口寫入一筆，關掉分頁重開後讀得回來', async ({ context }) => {
  const pageErrors = []
  const record = { id: 'scaffold-demo-1', label: '假資料：示範用' }

  const first = await openEntry(context, pageErrors)
  expect(await first.evaluate(id => window.__pptTest.idbProbe.get(id), record.id)).toBeUndefined()
  await first.evaluate(value => window.__pptTest.idbProbe.put(value), record)
  await first.close()

  const second = await openEntry(context, pageErrors)
  expect(await second.evaluate(id => window.__pptTest.idbProbe.get(id), record.id)).toEqual(record)
  await second.close()

  expect(pageErrors).toEqual([])
})
