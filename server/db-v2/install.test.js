import { describe, expect, test, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue(['020-second.sql', 'README.md', '010-first.sql']),
  readFile: vi.fn(async (url) => url.pathname.split('/').at(-1)),
}))

describe('SQL 安裝器', () => {
  test('依檔名排序，只透過傳入連線執行 SQL', async () => {
    const { install } = await import('./install.js')
    const client = { query: vi.fn() }
    await install(client)
    expect(client.query.mock.calls).toEqual([['010-first.sql'], ['020-second.sql']])
  })
})
