import { pointer, semesterAt } from './convert.js'
import { correctionCycleMembers } from './corrections.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const numeric = value => typeof value === 'number' && Number.isFinite(value)

// 直接走訪來源，不呼叫 convert，也不讀取轉換結果的列或錯誤。
export function validateSource(source, earnedFromLegacy) {
  const errors = []
  function error(code, path, value = null) {
    errors.push({ code, path, value: structuredClone(value) })
  }
  function record(value, path) {
    if (value === undefined) return {}
    if (object(value)) return value
    error('INVALID_OBJECT', path, value)
    return {}
  }
  function array(value, path, records = false) {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      error('INVALID_ARRAY', path, value)
      return []
    }
    if (!records) return value
    return value.map((item, i) => {
      if (object(item)) return item
      error('INVALID_RECORD', `${path}/${i}`, item)
      return {}
    })
  }
  function fields(value, path, keys) {
    const data = record(value, path)
    for (const key of Object.keys(data)) {
      if (!keys.split(' ').includes(key)) error('UNKNOWN_FIELD', `${path}/${pointer(key)}`, data[key])
    }
    return data
  }
  function enumeration(value, choices, code, path) {
    if (value !== undefined && !choices.includes(value)) error(code, path, value)
  }
  function index(values, path, idOf = item => item.id ?? null) {
    const map = new Map()
    values.forEach((value, i) => {
      const id = idOf(value)
      if (id === null) {
        error('MISSING_LEGACY_ID', `${path}/${i}`)
        return
      }
      const key = String(id)
      if (map.has(key)) error('DUPLICATE_LEGACY_ID', path, id)
      map.set(key, [...(map.get(key) || []), i])
    })
    return map
  }
  function reference(map, id, code, path) {
    const matches = map.get(String(id)) || []
    if (matches.length !== 1) {
      error(matches.length ? 'AMBIGUOUS_REFERENCE' : code, path, id)
      return null
    }
    return matches[0]
  }
  const data = record(source?.data, '/data')
  const settings = record(data.settings, '/data/settings')
  const classKey = source?.classId ?? data.classId ?? null
  if (typeof classKey !== 'string' || !classKey) error('INVALID_CLASS_ID', '/classId', classKey)
  if (source?.classId !== data.classId) error('CLASS_ID_CONFLICT', '/data/classId', data.classId)
  fields(source, '', 'classId className data')
  fields(data, '/data', 'classId className teacher students logs settings updatedAt')
  fields(settings, '/data/settings', 'currentSemester taskTypes groupAliases announcements jobs behaviorRules shop currency ruleCategories jobAssignments automation seatingChart semesterPeriods dailyDuty dutyJobId storeItems currencyRates')
  const declared = settings.currentSemester
  const current = declared === undefined || declared === null || declared === '' ? semesterAt(data.updatedAt) : typeof declared === 'string' && /^\d+-[12]$/.test(declared) ? declared : null
  if (declared && !current) error('INVALID_CURRENT_SEMESTER', '/data/settings/currentSemester', declared)
  if (!current) error('UNKNOWN_CURRENT_SEMESTER', '/data/updatedAt', data.updatedAt)
  const students = array(data.students, '/data/students', true)
  students.forEach((s, i) => {
    fields(s, `/data/students/${i}`, 'id uuid name number seatNumber group gender avatar inactive bank inventory comments taskExemptRules')
    if (s.inactive !== undefined && typeof s.inactive !== 'boolean') error('UNKNOWN_ENROLLMENT', `/data/students/${i}/inactive`, s.inactive)
  })
  const sm = index(students, '/data/students', s => s.id || s.uuid || null)
  const products = []
  const productPaths = []
  for (const [values, path] of [[settings.shop?.products, '/data/settings/shop/products'], [settings.storeItems, '/data/settings/storeItems']]) {
    array(values, path, true).forEach((p, i) => {
      fields(p, `${path}/${i}`, 'id name icon price priceUnit stock initialStock description')
      enumeration(p.priceUnit, ['point', 'fish', 'cookie'], 'UNKNOWN_PRICE_UNIT', `${path}/${i}/priceUnit`)
      products.push(p)
      productPaths.push(`${path}/${i}`)
    })
  }
  // 商品有兩個來源，重複編號共用一個索引；缺 ID 的路徑仍指向原陣列。
  const pm = new Map()
  products.forEach((p, i) => {
    if (p.id == null) {
      error('MISSING_LEGACY_ID', productPaths[i])
      return
    }
    const key = String(p.id)
    if (pm.has(key)) error('DUPLICATE_LEGACY_ID', '/data/settings/shop/products', p.id)
    pm.set(key, [...(pm.get(key) || []), i])
  })
  students.forEach((s, i) => validateStudent(s, `/data/students/${i}`))
  function validateStudent(s, path) {
    const bank = record(s.bank, `${path}/bank`)
    fields(bank, `${path}/bank`, 'balance totalEarned transactions')
    const txs = array(bank.transactions, `${path}/bank/transactions`, true)
    txs.forEach((t, j) => {
      const p = `${path}/bank/transactions/${j}`
      fields(t, p, 'id date amount reason balance type correctedTxId voided excludeFromTotal')
      if (!numeric(t.amount)) error('INVALID_AMOUNT', `${p}/amount`, t.amount)
      if (t.reason !== undefined && typeof t.reason !== 'string') error('INVALID_REASON', `${p}/reason`, t.reason)
      if (t.type !== undefined && t.type !== 'correction') error('UNKNOWN_TRANSACTION_TYPE', `${p}/type`, t.type)
      if (t.voided !== undefined && typeof t.voided !== 'boolean') error('UNKNOWN_VOIDED', `${p}/voided`, t.voided)
      error('UNKNOWN_TRANSACTION_SEMESTER', p)
    })
    const tm = index(txs, `${path}/bank/transactions`)
    const edges = new Map()
    txs.forEach((t, j) => {
      const p = `${path}/bank/transactions/${j}`
      const target = t.correctedTxId
      edges.set(j, target === undefined ? null : reference(tm, target, 'ORPHAN_CORRECTION', `${p}/correctedTxId`))
      if (t.type === 'correction' && target === undefined) error('ORPHAN_CORRECTION', p)
    })
    for (const j of correctionCycleMembers(edges)) error('CORRECTION_CYCLE', `${path}/bank/transactions/${j}`, txs[j].correctedTxId)
    const valid = txs.every(t => numeric(t.amount))
    const ledger = valid ? txs.reduce((sum, t) => sum + t.amount, 0) : null
    const earned = valid ? earnedFromLegacy(txs) : null
    let running = 0
    if (valid) {
      txs.forEach((t, j) => {
        running += t.amount
        if (t.balance !== undefined && t.balance !== running) error('TRANSACTION_BALANCE_DRIFT', `${path}/bank/transactions/${j}/balance`, { stored: t.balance, computed_from_zero: running })
      })
    }
    const balance = bank.balance === undefined ? 0 : bank.balance
    const total = bank.totalEarned === undefined ? earned : bank.totalEarned
    if (!numeric(balance)) error('INVALID_BALANCE', `${path}/bank/balance`, balance)
    if (!numeric(total)) error('INVALID_TOTAL_EARNED', `${path}/bank/totalEarned`, total)
    if (balance !== ledger) error('BALANCE_DRIFT', `${path}/bank`, { stored: balance, computed: ledger })
    if (total !== earned) error('TOTAL_EARNED_DRIFT', `${path}/bank`, { stored: total, computed: earned })
    array(s.inventory, `${path}/inventory`, true).forEach((item, j) => {
      fields(item, `${path}/inventory/${j}`, 'itemId name icon purchasedAt')
      reference(pm, item.itemId, 'ORPHAN_PRODUCT', `${path}/inventory/${j}/itemId`)
    })
    for (const [sem, c] of Object.entries(record(s.comments, `${path}/comments`))) {
      const p = `${path}/comments/${pointer(sem)}`
      fields(c, p, 'rawComment polishedComment motto analysis locked lockedComment lockedMotto status errorMessage generatedAt updatedAt modelUsed')
      for (const lock of ['locked', 'lockedComment', 'lockedMotto']) {
        if (c?.[lock] !== undefined && typeof c[lock] !== 'boolean') error('INVALID_LOCK', `${p}/${lock}`, c[lock])
      }
      if (!/^\d+-[12]$/.test(sem)) error('UNKNOWN_COMMENT_SEMESTER', p, sem)
      enumeration(c?.status, ['idle', 'generating', 'done', 'error'], 'UNKNOWN_COMMENT_STATUS', `${p}/status`)
    }
    if (Array.isArray(s.taskExemptRules)) s.taskExemptRules.forEach((r, j) => fields(r, `${path}/taskExemptRules/${j}`, 'keyword taskType'))
    else if (s.taskExemptRules !== undefined) fields(s.taskExemptRules, `${path}/taskExemptRules`, 'keywords taskTypes')
  }
  array(data.logs, '/data/logs', true).forEach((log, i) => {
    const p = `/data/logs/${i}`
    fields(log, p, 'date tasks status')
    const tasks = array(log.tasks, `${p}/tasks`, true)
    tasks.forEach((t, j) => {
      const tp = `${p}/tasks/${j}`
      fields(t, tp, 'id title type createdAt dueDate')
      enumeration(t.type, [...array(settings.taskTypes, '/data/settings/taskTypes'), '作業', '訂正', '攜帶物品', '考試', '通知單', '回條'], 'UNKNOWN_TASK_TYPE', `${tp}/type`)
      error('UNKNOWN_TASK_SEMESTER', tp)
      error('UNKNOWN_ASSIGNMENT_LIST', tp)
    })
    const tm = index(tasks, `${p}/tasks`)
    for (const [sid, values] of Object.entries(record(log.status, `${p}/status`))) {
      const sp = `${p}/status/${pointer(sid)}`
      reference(sm, sid, 'ORPHAN_STUDENT', sp)
      const vals = record(values, sp)
      const keys = new Set([...tasks.filter(t => t.id != null).map(t => String(t.id)), ...Object.keys(vals)])
      for (const key of keys) {
        const value = vals[key]
        if (value !== undefined && value !== true && value !== false && !['on_time', 'late', 'missing', 'leave', 'exempt', 'makeup'].includes(value)) error('UNKNOWN_STATUS', `${sp}/${pointer(key)}`, value)
        reference(tm, key, 'ORPHAN_TASK', `${sp}/${pointer(key)}`)
      }
    }
  })
  const jobs = array(settings.jobs, '/data/settings/jobs', true)
  jobs.forEach((job, i) => {
    const p = `/data/settings/jobs/${i}`
    fields(job, p, 'id title salary icon cycle category')
    enumeration(job.cycle, ['daily', 'weekly', 'monthly', 'semester', 'once'], 'UNKNOWN_JOB_CYCLE', `${p}/cycle`)
    enumeration(job.category, ['cadre', 'cleaning', 'other'], 'UNKNOWN_JOB_CATEGORY', `${p}/category`)
  })
  const jm = index(jobs, '/data/settings/jobs')
  for (const [job, ids] of Object.entries(record(settings.jobAssignments, '/data/settings/jobAssignments'))) {
    array(ids, `/data/settings/jobAssignments/${pointer(job)}`).forEach((sid, i) => {
      const p = `/data/settings/jobAssignments/${pointer(job)}/${i}`
      reference(jm, job, 'ORPHAN_JOB', p)
      reference(sm, sid, 'ORPHAN_STUDENT', p)
    })
  }
  if (settings.dutyJobId != null) reference(jm, settings.dutyJobId, 'ORPHAN_JOB', '/data/settings/dutyJobId')
  if (settings.dailyDuty !== undefined) {
    fields(settings.dailyDuty, '/data/settings/dailyDuty', 'date studentIds paid')
    array(settings.dailyDuty?.studentIds, '/data/settings/dailyDuty/studentIds').forEach((sid, i) => reference(sm, sid, 'ORPHAN_STUDENT', `/data/settings/dailyDuty/studentIds/${i}`))
  }
  if (settings.seatingChart !== undefined) {
    fields(settings.seatingChart, '/data/settings/seatingChart', 'rows cols grid objects customObjects perspective')
    for (const [coord, sid] of Object.entries(record(settings.seatingChart?.grid, '/data/settings/seatingChart/grid'))) reference(sm, sid, 'ORPHAN_STUDENT', `/data/settings/seatingChart/grid/${pointer(coord)}`)
    array(settings.seatingChart?.customObjects, '/data/settings/seatingChart/customObjects', true).forEach((v, i) => fields(v, `/data/settings/seatingChart/customObjects/${i}`, 'id name label icon color'))
  }
  for (const [key, keys] of [['announcements', 'id text color rotate'], ['behaviorRules', 'id label amount type icon category'], ['ruleCategories', 'id name icon']]) array(settings[key], `/data/settings/${key}`, true).forEach((v, i) => fields(v, `/data/settings/${key}/${i}`, keys))
  record(settings.groupAliases, '/data/settings/groupAliases')
  for (const [key, v] of Object.entries(record(settings.semesterPeriods, '/data/settings/semesterPeriods'))) fields(v, `/data/settings/semesterPeriods/${pointer(key)}`, 'start end')
  for (const [key, keys] of [['automation', 'dailyQuestBonus latePenalty missingPenalty'], ['shop', 'name icon products'], ['currency', 'base tier1 tier2'], ['currencyRates', 'fish cookie']]) {
    if (settings[key] !== undefined) fields(settings[key], `/data/settings/${key}`, keys)
  }
  for (const key of ['base', 'tier1', 'tier2']) {
    if (settings.currency?.[key] !== undefined) fields(settings.currency[key], `/data/settings/currency/${key}`, 'name icon rate')
  }
  return errors
}

export function orderedErrors(errors) {
  if (!Array.isArray(errors)) return errors
  return [...errors].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}
