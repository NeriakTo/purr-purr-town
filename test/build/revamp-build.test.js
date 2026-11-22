import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_HOOK_GLOBAL } from '../../src/revamp/testing/constants.js'
import { PROBE_DB_NAME } from '../../src/revamp/testing/hooks/idb-probe.js'

// 以子程序跑真正的 vite build，不在 vitest 裡呼叫 Vite API：
// vitest 會設 NODE_ENV=test，同一程序內建置可能不是正式建置。
const run = promisify(execFile)
const root = fileURLToPath(new URL('../..', import.meta.url))
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const markers = [TEST_HOOK_GLOBAL, PROBE_DB_NAME]
const outDirs = []

function buildEnv(extra) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'NODE_ENV' || key === 'PPT_BASE_PATH' || key.startsWith('VITEST')) delete env[key]
  }
  return { ...env, ...extra }
}

async function build({ mode, env = {} }) {
  const outDir = await mkdtemp(join(tmpdir(), 'ppt-revamp-build-'))
  outDirs.push(outDir)
  const args = [viteBin, 'build', '--config', 'vite.revamp.config.js', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error']
  if (mode) args.push('--mode', mode)
  await run(process.execPath, args, { cwd: root, env: buildEnv(env), maxBuffer: 16 * 1024 * 1024 })
  return outDir
}

async function readOutput(outDir) {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
  return Promise.all(files.map(async file => ({ file, content: await readFile(file) })))
}

function moduleScriptSources(html) {
  return [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(match => match[1])
}

describe('新版網頁的建置產物', () => {
  let production
  let testBuild

  beforeAll(async () => {
    const [productionDir, testDir] = await Promise.all([
      build({}),
      build({ mode: 'test', env: { PPT_BASE_PATH: '/' } }),
    ])
    production = { dir: productionDir, files: await readOutput(productionDir) }
    testBuild = { dir: testDir, files: await readOutput(testDir) }
  }, 120_000)

  afterAll(async () => {
    await Promise.all(outDirs.map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('正式建置：入口頁在產物根目錄，網址路徑預設 /purr-purr-town/', async () => {
    const html = await readFile(join(production.dir, 'index.html'), 'utf8')
    const sources = moduleScriptSources(html)
    expect(sources.length).toBeGreaterThan(0)
    for (const src of sources) expect(src.startsWith('/purr-purr-town/assets/')).toBe(true)
  })

  it('正式建置：入口頁不向外部網址請求資源', async () => {
    const html = await readFile(join(production.dir, 'index.html'), 'utf8')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('正式建置：產物裡找不到測試入口', () => {
    expect(production.files.length).toBeGreaterThan(0)
    for (const { file, content } of production.files) {
      for (const marker of markers) {
        expect(content.includes(marker), `${file} 含有 ${marker}`).toBe(false)
      }
    }
  })

  it('測試建置：網址路徑依 PPT_BASE_PATH 改成 /', async () => {
    const html = await readFile(join(testBuild.dir, 'index.html'), 'utf8')
    const sources = moduleScriptSources(html)
    expect(sources.length).toBeGreaterThan(0)
    for (const src of sources) expect(src.startsWith('/assets/')).toBe(true)
  })

  it('測試建置：產物裡有測試入口（對照組，避免上一項空過）', () => {
    for (const marker of markers) {
      expect(testBuild.files.some(({ content }) => content.includes(marker)), marker).toBe(true)
    }
  })
})
