// 建置時的網址路徑（Vite 的 base）。現行與新版網頁共用。
// 沒設時維持 GitHub Pages 的 /purr-purr-town/；放到測試站根目錄時設 PPT_BASE_PATH=/。
export const DEFAULT_BASE_PATH = '/purr-purr-town/'
export const BASE_PATH_ENV = 'PPT_BASE_PATH'

const SEGMENT = /^[A-Za-z0-9._~-]+$/

export function resolveBasePath(value) {
  if (value === undefined || value === '') return DEFAULT_BASE_PATH
  if (typeof value !== 'string' || !value.startsWith('/') || !value.endsWith('/')) {
    throw invalid(value)
  }
  if (value === '/') return value
  const segments = value.slice(1, -1).split('/')
  const valid = segments.every(segment => SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  if (!valid) throw invalid(value)
  return value
}

function invalid(value) {
  return new Error(`${BASE_PATH_ENV} 須是以 / 開頭並以 / 結尾的路徑，例如 / 或 /purr-purr-town/，收到：${JSON.stringify(value)}`)
}
