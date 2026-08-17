import {
  DEFAULT_SETTINGS,
  DEFAULT_DAILY_DUTY,
  DEFAULT_SEMESTER_PERIODS,
  DEFAULT_SEATING_CHART,
  DEFAULT_SHOP_PRODUCTS,
  SEATING_OBJECTS,
} from './constants'

// 預設商品的原始庫存，供承接舊資料時回推初始值（舊商品可能已賣到剩量不明）
const DEFAULT_INITIAL_STOCK = Object.fromEntries(
  DEFAULT_SHOP_PRODUCTS.map(p => [p.id, p.initialStock ?? p.stock])
)

// 建立新班級時，從既有班級承接「與學生、學期無關」的基礎設定。
//
// 設計理由（三喵會議 20260817 定案）：
// - 帶走的是班級經營規則（職務、獎懲、商店、貨幣、自動化、任務類型、小組別名）。
// - 一切綁定特定學生代號或特定學期的欄位一律重設，否則會把上一屆學生的痕跡
//   （職務指派、座位、值日生名單）混進新班，導致查無學生時整頁崩潰。
// - 商店庫存不承接舊班的「剩餘量」，改用商品的初始庫存 initialStock，
//   避免舊班賣到 0 的商品在新班一開學就顯示售完。

const CARRY_KEYS = [
  'jobs',
  'behaviorRules',
  'ruleCategories',
  'currency',
  'automation',
  'taskTypes',
  'groupAliases',
]

const BUILTIN_OBJECT_IDS = new Set(SEATING_OBJECTS.map(o => o.id))

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
}

// 商店商品：確保有 initialStock，並把 stock 設為 initialStock（新班從滿庫存開始）。
// 舊資料多半沒有 initialStock，且 stock 可能已被學生買到剩量不明——
// 對預設商品用 id 回推原始庫存，避免新班一開學就顯示售完。
function resetShopStock(products) {
  if (!Array.isArray(products)) return null
  return products.map(p => {
    const initialStock = p.initialStock !== undefined
      ? p.initialStock
      : (DEFAULT_INITIAL_STOCK[p.id] !== undefined ? DEFAULT_INITIAL_STOCK[p.id] : p.stock)
    return { ...p, initialStock, stock: initialStock }
  })
}

// 座位表：承接尺寸、視角、固定物件與自訂物件，但清空學生座位，
// 並丟棄越界座標與未知物件 ID。
function inheritSeatingChart(sc) {
  const base = clone(DEFAULT_SEATING_CHART)
  if (!sc || typeof sc !== 'object') return base

  const rows = Number.isInteger(sc.rows) && sc.rows > 0 ? sc.rows : base.rows
  const cols = Number.isInteger(sc.cols) && sc.cols > 0 ? sc.cols : base.cols
  const customObjects = Array.isArray(sc.customObjects) ? clone(sc.customObjects) : []
  const knownIds = new Set([...BUILTIN_OBJECT_IDS, ...customObjects.map(o => o.id)])

  const objects = {}
  for (const [coord, objId] of Object.entries(sc.objects || {})) {
    const [r, c] = String(coord).split('_').map(Number)
    if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < rows && c >= 0 && c < cols && knownIds.has(objId)) {
      objects[coord] = objId
    }
  }

  return {
    rows,
    cols,
    perspective: sc.perspective || base.perspective,
    grid: {}, // 一律清空學生座位
    objects,
    customObjects,
  }
}

/**
 * 從來源班級 settings 導出新班級 settings。
 * 不修改來源；回傳全新物件。來源為空時回傳一份預設 settings。
 * @param {object|null|undefined} sourceSettings
 * @returns {object}
 */
export function deriveInheritedSettings(sourceSettings) {
  const out = clone(DEFAULT_SETTINGS)
  if (!sourceSettings || typeof sourceSettings !== 'object') return out

  const src = clone(sourceSettings)

  // 承接白名單
  for (const key of CARRY_KEYS) {
    if (src[key] !== undefined) out[key] = src[key]
  }

  // 商店：名稱、圖示、商品定義帶走，庫存重設
  if (src.shop && typeof src.shop === 'object') {
    const products = resetShopStock(src.shop.products) || clone(DEFAULT_SETTINGS.shop.products)
    out.shop = { ...clone(DEFAULT_SETTINGS.shop), ...src.shop, products }
  }

  // 值日生職務：僅在它仍指向一個被承接的職務時保留
  const jobs = Array.isArray(out.jobs) ? out.jobs : []
  out.dutyJobId = src.dutyJobId && jobs.some(j => j.id === src.dutyJobId) ? src.dutyJobId : null

  // 座位表：清空學生、過濾越界與未知物件
  out.seatingChart = inheritSeatingChart(src.seatingChart)

  // 明確重設所有綁定學生或學期的欄位
  out.jobAssignments = {}
  out.dailyDuty = clone(DEFAULT_DAILY_DUTY)
  out.announcements = []
  out.semesterPeriods = clone(DEFAULT_SEMESTER_PERIODS)
  out.currentSemester = null

  return out
}

// 供 UI 預覽用：條列將帶走什麼。
export function summarizeInheritance(sourceSettings) {
  if (!sourceSettings || typeof sourceSettings !== 'object') return []
  const s = sourceSettings
  const items = []
  if (Array.isArray(s.jobs)) items.push(`職務 ${s.jobs.length} 項`)
  if (Array.isArray(s.behaviorRules)) items.push(`獎懲規則 ${s.behaviorRules.length} 條`)
  if (s.shop?.products) items.push(`商店商品 ${s.shop.products.length} 項（庫存重設為初始值）`)
  if (s.currency) items.push('貨幣設定')
  if (s.automation) items.push('自動化加扣分')
  if (Array.isArray(s.taskTypes)) items.push(`任務類型 ${s.taskTypes.length} 種`)
  return items
}
