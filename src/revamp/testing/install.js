import { TEST_HOOK_GLOBAL } from './constants.js'

// 只供測試的操作入口（測試建置才有）。瀏覽器測試用 window.__pptTest.<名稱> 直接建立資料或操作，
// 不必經過畫面。擴充方式：在 hooks/ 底下新增一個檔案，匯出
//   name：掛在 window.__pptTest 上的名稱（不得重複）
//   create(deps)：回傳該入口的方法；deps 目前有 indexedDB
const hookModules = import.meta.glob(['./hooks/*.js', '!./hooks/*.test.js'], { eager: true })

export function buildTestApi(modules, deps) {
  const api = {}
  for (const [path, hook] of Object.entries(modules)) {
    if (typeof hook.name !== 'string' || !hook.name) throw new Error(`測試入口模組 ${path} 缺少 name`)
    if (typeof hook.create !== 'function') throw new Error(`測試入口模組 ${path} 缺少 create`)
    if (Object.hasOwn(api, hook.name)) throw new Error(`測試入口名稱重複：${hook.name}（${path}）`)
    api[hook.name] = hook.create(deps)
  }
  return Object.freeze(api)
}

export function installTestHooks(target) {
  if (Object.hasOwn(target, TEST_HOOK_GLOBAL)) throw new Error(`${TEST_HOOK_GLOBAL} 已經安裝過`)
  const api = buildTestApi(hookModules, { indexedDB: target.indexedDB })
  Object.defineProperty(target, TEST_HOOK_GLOBAL, {
    value: api,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return api
}
