import { readFile } from 'node:fs/promises'

const directory = new URL('../../../docs/revamp/operation-contract/', import.meta.url)

export async function readResultCodes() {
  const contents = await readFile(new URL('01-操作規格-v0.4-總則.md', directory), 'utf8')
  const [, retrySection, finalSection] = contents.split(/^### 5\.[12] /m)
  const finalText = finalSection.split(/^## /m)[0]
  return { retry: codeRows(retrySection), final: codeRows(finalText) }
}

function codeRows(section) {
  return [...section.matchAll(/^\| (E-\d+) \| `([A-Z_]+)`([^|]*) \|/gm)]
    .map(([, id, code, suffix]) => ({ id, code, removed: suffix.includes('已移除') }))
}
