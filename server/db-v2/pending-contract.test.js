import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('未實作清單與 SQL 標記都是空的', async () => {
  const sqlDirectory = new URL('./sql/', import.meta.url)
  const files = (await readdir(sqlDirectory)).filter(name => name.endsWith('.sql'))
  const sql = await Promise.all(files.map(name => readFile(new URL(name, sqlDirectory), 'utf8')))
  const marked = sql.flatMap(file => [...file.matchAll(/^[ \t]*--[ \t]*PPT-PENDING:[ \t]*(\S+)[ \t]*$/gm)]
    .map(([, key]) => key))
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8')
  const sections = readme.split(/^## /m)
  const pending = sections.find(section => section.startsWith('未實作清單\n'))
  expect(pending).toBeDefined()
  const documented = [...pending.matchAll(/^\|[ \t]*`([^\s`]+)`[ \t]*\|/gm)].map(([, key]) => key)
  expect(documented).toEqual([])
  expect(marked).toEqual([])
})
