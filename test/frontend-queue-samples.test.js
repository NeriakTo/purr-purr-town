import { readdir, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const directory = new URL('../docs/revamp/frontend-queue/', import.meta.url)
const samplesDirectory = new URL('samples/', directory)

test('每份樣本皆為合法 JSON 且包含對照表的必有欄位', async () => {
  const document = await readFile(new URL('01-收據與讀取格式逐欄對照.md', directory), 'utf8')
  const section = document.split('<!-- samples:start -->')[1]?.split('<!-- samples:end -->')[0]
  expect(section, '缺少樣本必有欄位表').toBeDefined()
  const requirements = [...section.matchAll(/^\| `([\w-]+\.json)` \| `([^`]+)` \| `([^`]+)` \|$/gm)]
  expect(requirements.length).toBeGreaterThan(0)

  const files = await readdir(samplesDirectory)
  expect(files.sort()).toEqual([...new Set(requirements.map(([, file]) => file))].sort())
  const samples = new Map(await Promise.all(files.map(async file => [
    file, JSON.parse(await readFile(new URL(file, samplesDirectory), 'utf8')),
  ])))

  for (const [, file, path, fields] of requirements) {
    const location = path === '$' ? [] : path.replace(/^\$\./, '').split('.')
    const value = location.reduce((parent, key) => parent?.[key], samples.get(file))
    expect(value, file + ' ' + path).toBeTypeOf('object')
    expect(value, file + ' ' + path).not.toBeNull()
    for (const field of fields.split(' ')) {
      expect(Object.hasOwn(value, field), file + ' ' + path + '.' + field).toBe(true)
    }
  }
})
