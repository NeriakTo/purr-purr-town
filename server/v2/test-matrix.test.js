import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('對照表的每個檔名與測試名稱都指向現有測試', async () => {
  const matrix = await readFile(new URL('./test-matrix.md', import.meta.url), 'utf8')
  const references = [...matrix.matchAll(/`([^`\n]+)::([^`\n]+)`/g)]
  expect(references.length).toBeGreaterThan(0)

  const titlesByFile = new Map()
  for (const [reference, path, title] of references) {
    if (!titlesByFile.has(path)) {
      const source = await readFile(new URL(path, import.meta.url), 'utf8')
      const tests = source.matchAll(/^\s*(?:it|test)(?:\.(?:each|skipIf)\([\s\S]*?\))?\(\s*(['"])([^\n]*?)\1/gm)
      titlesByFile.set(path, new Set(Array.from(tests, match => match[2])))
    }
    expect(titlesByFile.get(path), reference).toContain(title)
  }
})
