import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_HOOK_GLOBAL } from '../../src/revamp/testing/constants.js'
import { PROBE_DB_NAME } from '../../src/revamp/testing/hooks/idb-probe.js'
import revampConfig from '../../vite.revamp.config.js'

// 以子程序跑真正的建置（run-revamp-build.js，用 vite.revamp.config.js），不在 vitest 程序裡建置：
// vitest 會設 NODE_ENV=test，同一程序內建置可能不是正式建置。
// 子程序另外回報進到產物的原始模組清單，測試據此檢查 src/revamp/testing/ 底下的檔案有沒有進正式建置。
const run = promisify(execFile)
const root = fileURLToPath(new URL('../..', import.meta.url))
const runner = join(root, 'test', 'build', 'run-revamp-build.js')
const revampRoot = join(root, 'src', 'revamp')
const testingDir = join(revampRoot, 'testing')
const distDir = join(root, 'dist')
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
  const workDir = await mkdtemp(join(tmpdir(), 'ppt-revamp-build-'))
  outDirs.push(workDir)
  const outDir = join(workDir, 'dist')
  const reportFile = join(workDir, 'modules.json')
  await run(process.execPath, [runner, mode, outDir, reportFile], { cwd: root, env: buildEnv(env), maxBuffer: 16 * 1024 * 1024 })
  const modules = JSON.parse(await readFile(reportFile, 'utf8')).map(normalizeModuleId)
  return { dir: outDir, files: await readOutput(outDir), modules }
}

// 模組編號可能帶 \0 前綴（虛擬模組）或 ?查詢字串；資源檔的原始檔是相對於 src/revamp/ 的路徑。
function normalizeModuleId(id) {
  const path = id.replace(/^\0/, '').split('?')[0]
  return isAbsolute(path) ? resolve(path) : resolve(revampRoot, path)
}

function isSameOrInside(path, dir) {
  const rel = relative(dir, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
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
    [production, testBuild] = await Promise.all([
      build({ mode: 'production' }),
      build({ mode: 'test', env: { PPT_BASE_PATH: '/' } }),
    ])
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

  it('正式建置：src/revamp/testing/ 底下的檔案一個都沒有進到產物（依建置的模組清單）', () => {
    expect(production.modules).toContain(join(revampRoot, 'main.jsx'))
    expect(production.modules.filter(id => isSameOrInside(id, testingDir))).toEqual([])
  })

  it('測試建置：模組清單收得到 src/revamp/testing/ 底下的檔案（對照組，避免上一項空過）', () => {
    expect(testBuild.modules).toContain(join(testingDir, 'install.js'))
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

describe('新版網頁的建置設定', () => {
  // 不帶 --outDir 時的輸出目錄。dist/ 是現行網頁的發佈目錄（npm run deploy 發佈它），
  // 新版的產物不能寫進去、不能是它的上層（建置前會清空輸出目錄），也不能就是它。
  it.each(['production', 'test'])('%s 模式預設的輸出目錄與現行網頁的 dist/ 互不重疊', mode => {
    const config = revampConfig({ command: 'build', mode, isSsrBuild: false, isPreview: false })
    const outDir = resolve(config.root ?? root, config.build?.outDir ?? 'dist')
    expect(isSameOrInside(outDir, distDir), `${outDir} 在 dist/ 裡面`).toBe(false)
    expect(isSameOrInside(distDir, outDir), `${outDir} 是 dist/ 的上層`).toBe(false)
  })
})
