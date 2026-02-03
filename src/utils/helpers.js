import { format } from 'date-fns'
import { STATUS_VALUES, AVATAR_EMOJIS, AVATAR_COLORS, DEFAULT_CURRENCY } from './constants'
import { Check, Clock, XCircle, Coffee, CircleMinus, BookOpen, AlertTriangle, Palette, ScrollText } from 'lucide-react'

export function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function formatDateDisplay(dateStr) {
  return dateStr.replace(/-/g, '/')
}

export function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDate(date) {
  return format(date, 'yyyy-MM-dd')
}

export function formatDateShort(dateInput) {
  if (!dateInput) return ''
  try {
    return format(new Date(dateInput), 'yyyy/MM/dd')
  } catch {
    return ''
  }
}

// --- Task Date Logic (v2.2.0) ---

export function getNextDay(dateStr) {
  const date = parseDate(dateStr)
  date.setDate(date.getDate() + 1)
  return formatDate(date)
}

export function getTaskDueDate(task, logDate) {
  return task.dueDate || logDate
}

export function getTaskCreatedAt(task, logDate) {
  return task.createdAt || logDate
}

export function getTasksForDate(allLogs, targetDateStr, normalizeDateFn) {
  const results = []
  allLogs.forEach(log => {
    const logDate = normalizeDateFn(log.date)
    const logTasks = log.tasks || []
    logTasks.forEach(task => {
      const dueDate = getTaskDueDate(task, logDate)
      if (normalizeDateFn(dueDate) === targetDateStr) {
        results.push({ task, logDate })
      }
    })
  })
  return results
}

// v3.0.1: 投影模式用 - 篩選 createdAt === 今天 的任務（今天發布、明天要交）

export function getTasksCreatedToday(allLogs, todayStr, normalizeDateFn) {
  const results = []
  allLogs.forEach(log => {
    const logDate = normalizeDateFn(log.date)
    const logTasks = log.tasks || []
    logTasks.forEach(task => {
      const createdAt = getTaskCreatedAt(task, logDate)
      if (normalizeDateFn(createdAt) === todayStr) {
        results.push({ task, logDate })
      }
    })
  })
  return results
}

export function getClassCacheKey(classId) {
  return `ppt_cache_class_${classId}`
}

export function loadClassCache(classId) {
  if (!classId) return null
  try {
    const raw = localStorage.getItem(getClassCacheKey(classId))
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.error('讀取本地快取失敗:', err)
    return null
  }
}

export function saveClassCache(classId, payload) {
  if (!classId || !payload) return
  try {
    localStorage.setItem(getClassCacheKey(classId), JSON.stringify(payload))
  } catch (err) {
    console.error('寫入本地快取失敗:', err)
  }
}

export function getLocalClassesKey() {
  return 'ppt_local_classes'
}

export function loadLocalClasses() {
  try {
    const raw = localStorage.getItem(getLocalClassesKey())
    return raw ? JSON.parse(raw) : []
  } catch (err) {
    console.error('讀取本地班級清單失敗:', err)
    return []
  }
}

export function saveLocalClasses(classes) {
  try {
    localStorage.setItem(getLocalClassesKey(), JSON.stringify(classes))
  } catch (err) {
    console.error('寫入本地班級清單失敗:', err)
  }
}

export function normalizeStatus(value) {
  if (value === true) return STATUS_VALUES.ON_TIME
  if (value === 'leave') return STATUS_VALUES.LEAVE
  if (value === 'exempt') return STATUS_VALUES.EXEMPT
  if (Object.values(STATUS_VALUES).includes(value)) return value
  return value // false, undefined, etc. remain as-is
}

export function isDoneStatus(value) {
  const norm = normalizeStatus(value)
  return norm === STATUS_VALUES.ON_TIME || norm === STATUS_VALUES.LATE
}

// v3.0.1: 是否計入分母（排除 leave、exempt）

export function isCountedInDenominator(value) {
  const norm = normalizeStatus(value)
  return norm !== STATUS_VALUES.LEAVE && norm !== STATUS_VALUES.EXEMPT
}

export function getStatusLabel(value) {
  const norm = normalizeStatus(value)
  switch (norm) {
    case STATUS_VALUES.ON_TIME: return '準時'
    case STATUS_VALUES.LATE: return '遲交'
    case STATUS_VALUES.MISSING: return '未交'
    case STATUS_VALUES.LEAVE: return '請假'
    case STATUS_VALUES.EXEMPT: return '免交'
    default: return ''
  }
}

export function getStatusVisual(value) {
  const norm = normalizeStatus(value)
  switch (norm) {
    case STATUS_VALUES.ON_TIME:
      return { icon: Check, color: '#7BC496', bg: 'bg-[#A8D8B9]/20', border: 'border-[#A8D8B9]', text: 'text-[#4A7C59]', label: '準時' }
    case STATUS_VALUES.LATE:
      return { icon: Clock, color: '#FFBF69', bg: 'bg-[#FFD6A5]/20', border: 'border-[#FFD6A5]', text: 'text-[#8B6914]', label: '遲交' }
    case STATUS_VALUES.MISSING:
      return { icon: XCircle, color: '#D64545', bg: 'bg-[#FFADAD]/20', border: 'border-[#FFADAD]', text: 'text-[#D64545]', label: '未交' }
    case STATUS_VALUES.LEAVE:
      return { icon: Coffee, color: '#8B8B8B', bg: 'bg-[#E8E8E8]/50', border: 'border-[#D8D8D8]', text: 'text-[#8B8B8B]', label: '請假' }
    case STATUS_VALUES.EXEMPT:
      return { icon: CircleMinus, color: '#B8B8B8', bg: 'bg-[#F0F0F0]/50', border: 'border-[#E0E0E0]', text: 'text-[#A0A0A0]', label: '免交' }
    default:
      return { icon: null, color: '#D8D8D8', bg: 'bg-white', border: 'border-[#E8E8E8]', text: 'text-[#5D5D5D]', label: '' }
  }
}

export function getTaskIcon(title) {
  const lower = title?.toLowerCase() || ''
  if (lower.includes('習') || lower.includes('作業') || lower.includes('國') || lower.includes('數') || lower.includes('英')) {
    return BookOpen
  }
  if (lower.includes('訂正') || lower.includes('補')) {
    return AlertTriangle
  }
  if (lower.includes('水彩') || lower.includes('美') || lower.includes('畫')) {
    return Palette
  }
  return ScrollText
}

export function getTaskTypeColor(titleOrType) {
  const s = (titleOrType || '').toLowerCase()
  if (s.includes('作業') || s.includes('習')) return { border: 'border-l-blue-400', accent: '#60A5FA', bg: 'bg-blue-50/50' }
  if (s.includes('攜帶') || s.includes('物品')) return { border: 'border-l-amber-400', accent: '#F59E0B', bg: 'bg-amber-50/50' }
  if (s.includes('回條') || s.includes('通知')) return { border: 'border-l-rose-400', accent: '#FB7185', bg: 'bg-rose-50/50' }
  return { border: 'border-l-green-400', accent: '#34D399', bg: 'bg-green-50/50' }
}

export function hashSeed(seed) {
  const str = String(seed ?? '')
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

export function makeTaskId(dateStr, task, index) {
  const base = `${dateStr}-${task?.title || ''}-${task?.type || ''}-${index}`
  return `task_${hashSeed(base).toString(36)}`
}

// --- Avatar Unique-First 演算法 (v3.3.4) ---

function seededRng(seed) {
  let h = hashSeed(seed)
  return () => {
    h = (h * 16807 + 1) >>> 0
    return h / 0x100000000
  }
}

function seededShuffle(arr, seed) {
  const shuffled = [...arr]
  const rng = seededRng(seed)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

const _avatarPoolCache = {}

function getAvatarPool(classSeed) {
  if (!_avatarPoolCache[classSeed]) {
    _avatarPoolCache[classSeed] = {
      emojis: seededShuffle(AVATAR_EMOJIS, classSeed),
      colors: seededShuffle(AVATAR_COLORS, classSeed),
    }
  }
  return _avatarPoolCache[classSeed]
}

export function getAvatarMeta(seed) {
  const str = String(seed ?? '')
  const match = str.match(/^s_(.+)_(\d+)$/)
  if (match) {
    const classSeed = match[1]
    const studentNum = parseInt(match[2], 10)
    const pool = getAvatarPool(classSeed)
    const idx = (studentNum - 1) % pool.emojis.length
    const colorIdx = (studentNum - 1) % pool.colors.length
    return { emoji: pool.emojis[idx], bg: pool.colors[colorIdx] }
  }
  const hash = hashSeed(seed)
  return {
    emoji: AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length],
    bg: AVATAR_COLORS[(hash + 3) % AVATAR_COLORS.length]
  }
}

export function isDefaultName(name, number) {
  if (!name || !number) return false
  try {
    const defaultPattern = new RegExp(`^${number}號村民$`)
    return defaultPattern.test(name) || name === `${number}號村民`
  } catch (err) {
    return false
  }
}

// ============================================
// v3.5.1: ?????? (Currency System)
// ============================================

export function resolveCurrency(input) {
  if (!input) return DEFAULT_CURRENCY
  const fromSettings = input.currency || input.currencyRates ? input : null
  const currency = fromSettings ? (input.currency || input.currencyRates) : input

  if (currency?.base && currency?.tier1 && currency?.tier2) {
    return {
      base: { ...DEFAULT_CURRENCY.base, ...currency.base },
      tier1: {
        ...DEFAULT_CURRENCY.tier1,
        ...currency.tier1,
        rate: parseInt(currency.tier1?.rate, 10) > 0 ? parseInt(currency.tier1.rate, 10) : DEFAULT_CURRENCY.tier1.rate,
      },
      tier2: {
        ...DEFAULT_CURRENCY.tier2,
        ...currency.tier2,
        rate: parseInt(currency.tier2?.rate, 10) > 0 ? parseInt(currency.tier2.rate, 10) : DEFAULT_CURRENCY.tier2.rate,
      },
    }
  }

  if (currency?.fish || currency?.cookie) {
    return {
      base: { ...DEFAULT_CURRENCY.base },
      tier1: {
        ...DEFAULT_CURRENCY.tier1,
        rate: parseInt(currency.fish, 10) > 0 ? parseInt(currency.fish, 10) : DEFAULT_CURRENCY.tier1.rate,
      },
      tier2: {
        ...DEFAULT_CURRENCY.tier2,
        rate: parseInt(currency.cookie, 10) > 0 ? parseInt(currency.cookie, 10) : DEFAULT_CURRENCY.tier2.rate,
      },
    }
  }

  return DEFAULT_CURRENCY
}

export function getCurrencyUnitMeta(unit, currencyInput) {
  const currency = resolveCurrency(currencyInput)
  if (unit === 'cookie') return { unit: 'cookie', ...currency.tier2 }
  if (unit === 'fish') return { unit: 'fish', ...currency.tier1 }
  return { unit: 'point', rate: 1, ...currency.base }
}

export function formatCurrency(points, currencyInput) {
  const currency = resolveCurrency(currencyInput)
  const tier2Rate = parseInt(currency.tier2.rate, 10) > 0 ? parseInt(currency.tier2.rate, 10) : DEFAULT_CURRENCY.tier2.rate
  const tier1Rate = parseInt(currency.tier1.rate, 10) > 0 ? parseInt(currency.tier1.rate, 10) : DEFAULT_CURRENCY.tier1.rate
  const abs = Math.abs(points)
  const sign = points < 0 ? '-' : ''
  const tier2 = Math.floor(abs / tier2Rate)
  const remainder = abs % tier2Rate
  const tier1 = Math.floor(remainder / tier1Rate)
  const raw = remainder % tier1Rate

  const parts = []
  if (tier2 > 0) parts.push(`${tier2} ${currency.tier2.icon} ${currency.tier2.name}`)
  if (tier1 > 0) parts.push(`${tier1} ${currency.tier1.icon} ${currency.tier1.name}`)
  const baseLabel = `${currency.base.icon ? `${currency.base.icon} ` : ''}${currency.base.name || '??'}`
  const display = `${sign}${parts.length > 0 ? parts.join(' ') + ' ' : ''}(${sign}${abs} ${baseLabel})`

  return {
    tier2,
    tier1,
    raw,
    cookies: tier2,
    fish: tier1,
    baseLabel,
    display,
  }
}

export function toPoints(amount, unit, currencyInput) {
  const meta = getCurrencyUnitMeta(unit, currencyInput)
  if (unit === 'cookie') return amount * (meta.rate || 1)
  if (unit === 'fish') return amount * (meta.rate || 1)
  return amount
}

export function formatBalanceBadge(balance, currencyInput) {
  const currency = resolveCurrency(currencyInput)
  const tier2Rate = parseInt(currency.tier2.rate, 10) > 0 ? parseInt(currency.tier2.rate, 10) : DEFAULT_CURRENCY.tier2.rate
  const tier1Rate = parseInt(currency.tier1.rate, 10) > 0 ? parseInt(currency.tier1.rate, 10) : DEFAULT_CURRENCY.tier1.rate

  if (balance >= tier2Rate) return `${Math.floor(balance / tier2Rate)}${currency.tier2.icon}`
  if (balance >= tier1Rate) return `${Math.floor(balance / tier1Rate)}${currency.tier1.icon}`
  return `${balance}${currency.base.icon || ''}`
}

export function ensureStudentBank(student) {
  if (student.bank && student.inventory) return student
  return {
    ...student,
    bank: student.bank || { balance: 0, transactions: [] },
    inventory: student.inventory || [],
  }
}

export function createTransaction(bank, amount, reason) {
  const newBalance = (bank.balance || 0) + amount
  const tx = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    amount,
    reason,
    balance: newBalance,
  }
  return {
    balance: newBalance,
    transactions: [...(bank.transactions || []), tx],
  }
}

export function generateId(prefix = 'item') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ============================================
// Loading 畫面元件
// ============================================
