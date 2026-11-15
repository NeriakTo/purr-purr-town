import { validateSource, orderedErrors } from "./source-validation.js"
import { correctionCycleMembers, correctionTargets } from "./corrections.js"
import { isDeepStrictEqual } from 'node:util'
import { digest, pointer, semesterAt, TABLES } from './convert.js'

const list = v => Array.isArray(v) ? v : []
const entries = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : []
const numeric = v => typeof v === 'number' && Number.isFinite(v)

function recordList(value) {
  return list(value).map(normalizeRecord)
}

function normalizeRecord(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}

function projectTransactions(transactions) {
  const byId = new Map(transactions.map(transaction => [transaction.id, transaction]))
  return transactions.map(transaction => {
    const target = byId.get(transaction.corrected_transaction_id)
    // 舊 helper 對 0／空字串不進入商店更正判斷；依已解析的目標列保留此語意。
    const correction = target?.legacy_id ? transaction.corrected_transaction_id : null
    return {
      id: transaction.id,
      date: transaction.occurred_at,
      reason: transaction.reason,
      amount: transaction.amount,
      voided: transaction.voided,
      type: transaction.transaction_type,
      correctedTxId: correction,
    }
  })
}

// 獨立照 helpers.js:435 的舊統計計算，不能用新版帳本函式重算舊來源。
export function legacyEarned(transactions, { startDate, endDate } = {}) {
  const dated = list(transactions).filter(t => {
    if (!startDate && !endDate) return true
    const ms = Date.parse(t.date)
    if (!Number.isFinite(ms)) return false
    const day = new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
    return (!startDate || day >= startDate) && (!endDate || day <= endDate)
  })
  const isStore = t => typeof t?.reason === 'string' && /^(購買|使用道具)/.test(t.reason)
  const map = Object.fromEntries(dated.map(t => [t.id, t]))
  return dated.filter(t => !t.voided && !isStore(t) && !(t.type === 'correction' && t.correctedTxId && isStore(map[t.correctedTxId]))).reduce((n, t) => n + (t.amount || 0), 0)
}

export function reconcile(source, converted) {
  const differences = [], students = [], rows = converted?.rows || {}, expected = new Map()
  const diff = (path, expected, actual) => { if (!isDeepStrictEqual(expected, actual)) differences.push({ path, expected, actual }) }
  const one = (table, path) => list(rows[table]).find(r => r.source_path === path)
  const expectRow = (table, path, raw, fields = {}) => {
    if (!expected.has(table)) expected.set(table, [])
    expected.get(table).push(path)
    const row = one(table, path)
    diff(`${table}${path}/raw`, raw === undefined ? null : raw, row?.raw)
    const key = path.split('/').at(-1)?.replaceAll('~1', '/').replaceAll('~0', '~')
    const legacy = table === 'classes' ? source?.classId ?? source?.data?.classId ?? null : table === 'students' ? raw?.id || raw?.uuid || null : ['transactions', 'tasks', 'products', 'jobs', 'announcements', 'rules'].includes(table) ? raw?.id ?? null : table === 'inventory_items' ? raw?.itemId ?? null : ['groups', 'submissions'].includes(table) ? key : null
    diff(`${table}${path}/legacy_id`, legacy, row?.legacy_id)
    for (const [key, value] of Object.entries(fields)) {
      if (key === "validation_errors") diff(`${table}${path}/${key}`, orderedErrors(value), orderedErrors(row?.[key]))
      else diff(`${table}${path}/${key}`, value, row?.[key])
    }
    return row
  }
  const data = source?.data || {}, settings = data.settings || {}, classKey = source?.classId ?? data.classId ?? null
  const classId = digest(['class', classKey]), batchId = digest(['v2-1A', classKey, source])
  const sourceErrors = validateSource(source, legacyEarned)
  diff("errors", orderedErrors(sourceErrors), orderedErrors(converted?.errors))
  expectRow('migration_batches', '', null, { id: batchId, source_hash: digest(source), import_rules_enabled: false, converter_version: 'v2-1A', validation_errors: sourceErrors })
  expectRow('migration_sources', '', source)
  const declared = settings.currentSemester
  const currentSemester = declared === undefined || declared === null || declared === '' ? semesterAt(data.updatedAt) : typeof declared === 'string' && /^\d+-[12]$/.test(declared) ? declared : null
  expectRow('classes', '/data', data, { id: classId, name: data.className ?? source?.className ?? null, teacher: data.teacher ?? null, current_semester: currentSemester })
  const lookup = (table, legacy) => {
    const found = list(rows[table]).filter(r => r.legacy_id !== null && String(r.legacy_id) === String(legacy))
    return found.length === 1 ? found[0].id : null
  }
  recordList(data.students).forEach((s, i) => {
    const p = `/data/students/${i}`
    const sr = expectRow('students', p, s, { legacy_id: s.id || s.uuid || null, name: s.name ?? null, seat_number: s.number ?? null, group_key: s.group == null ? null : String(s.group), avatar: s.avatar ?? null, enrollment_status: typeof s.inactive === 'boolean' || s.inactive === undefined ? (s.inactive ? 'home_study' : 'enrolled') : 'unknown' })
    const bank = s.bank || {}, txs = recordList(bank.transactions), valid = txs.every(t => numeric(t.amount))
    const earned = valid ? legacyEarned(txs) : null
    const ledger = valid ? txs.reduce((n, t) => n + t.amount, 0) : null
    const balance = bank.balance === undefined ? 0 : bank.balance
    const total = bank.totalEarned === undefined ? earned : bank.totalEarned
    expectRow('accounts', `${p}/bank`, s.bank, { student_id: sr?.id, balance: numeric(balance) ? balance : null, total_earned: numeric(total) ? total : null, ledger_sum: ledger, earned_recomputed: earned, total_earned_source: bank.totalEarned === undefined ? 'legacy_recomputed' : 'legacy_stored' })
    const actualTxs = list(rows.transactions).filter(t => t.student_id === sr?.id)
    diff(`${p}/transaction_count`, txs.length, actualTxs.length)
    const correctionEdges = correctionTargets(txs)
    const cycleMembers = correctionCycleMembers(correctionEdges)
    txs.forEach((t, j) => {
      const targetIndex = correctionEdges.get(j)
      const targetRow = targetIndex === null ? null : one("transactions", `${p}/bank/transactions/${targetIndex}`)
      expectRow('transactions', `${p}/bank/transactions/${j}`, t, { student_id: sr?.id, legacy_id: t.id ?? null, amount: numeric(t.amount) ? t.amount : null, reason: t.reason ?? null, occurred_at: t.date ?? null, balance_after: t.balance ?? null, voided: Boolean(t.voided), transaction_type: t.type ?? 'legacy', corrected_transaction_id: t.correctedTxId === undefined || cycleMembers.has(j) ? null : targetRow?.id ?? null, semester: null, legacy_semantics: true })
    })
    diff(`${p}/converted_ledger_sum`, ledger, actualTxs.every(t => numeric(t.amount)) ? actualTxs.reduce((n, t) => n + t.amount, 0) : null)
    recordList(s.inventory).forEach((item, j) => expectRow('inventory_items', `${p}/inventory/${j}`, item, { student_id: sr?.id, product_id: lookup('products', item.itemId), legacy_index: j, purchase_transaction_id: null, consumed: false }))
    const inv = list(rows.inventory_items).filter(r => r.student_id === sr?.id)
    diff(`${p}/inventory_count`, recordList(s.inventory).length, inv.length)
    const usages = actualTxs.filter(t => typeof t.reason === 'string' && t.reason.startsWith('使用道具')).length
    diff(`${p}/usage_count`, txs.filter(t => typeof t.reason === 'string' && t.reason.startsWith('使用道具')).length, usages)
    entries(s.comments).forEach(([sem, c]) => expectRow('comments', `${p}/comments/${pointer(sem)}`, c, { student_id: sr?.id, semester: sem, locked_comment: c?.lockedComment ?? c?.locked ?? false, locked_motto: c?.lockedMotto ?? c?.locked ?? false }))
    if (s.taskExemptRules !== undefined) {
      if (Array.isArray(s.taskExemptRules)) s.taskExemptRules.forEach((v, j) => expectRow('exempt_rules', `${p}/taskExemptRules/${j}`, v, { student_id: sr?.id }))
      else expectRow('exempt_rules', `${p}/taskExemptRules`, s.taskExemptRules, { student_id: sr?.id })
    }
    const periods = {}
    for (const [period, bounds] of entries(settings.semesterPeriods)) {
      const options = { startDate: bounds?.start || undefined, endDate: bounds?.end || undefined }
      const projected = projectTransactions(actualTxs)
      periods[period] = valid ? legacyEarned(txs, options) : null
      diff(`${p}/period/${period}`, periods[period], valid ? legacyEarned(projected, options) : null)
    }
    students.push({ legacy_id: s.id || s.uuid || null, balance, total_earned: total, transaction_count: txs.length, correction_edges: txs.filter(t => t.correctedTxId !== undefined).map(t => [t.id, t.correctedTxId]), inventory_count: recordList(s.inventory).length, usage_count: usages, comment_semesters: entries(s.comments).map(([sem]) => sem), periods })
  })
  recordList(data.logs).forEach((log, i) => {
    const p = `/data/logs/${i}`, lr = expectRow('logs', p, log)
    recordList(log.tasks).forEach((t, j) => expectRow('tasks', `${p}/tasks/${j}`, t, { legacy_id: t.id ?? null, log_id: lr?.id, title: t.title ?? null, task_type: t.type ?? null, published_on: t.createdAt ?? log.date ?? null, due_on: t.dueDate ?? log.date ?? null, semester: null, correction_state: t.type === '訂正' ? 'legacy_unlinked' : null, original_task_id: null, teacher_confirmed: null, assignees_known: false }))
    entries(log.status).forEach(([sid, values]) => {
      const vals = Object.fromEntries(entries(values))
      const keys = [...new Set([...recordList(log.tasks).filter(t => t.id != null).map(t => String(t.id)), ...entries(vals).map(([key]) => key)])]
      for (const key of keys) {
        const value = vals?.[key], present = Object.hasOwn(vals || {}, key)
        const status = value === true ? 'on_time' : value === false || !present ? 'pending' : ['on_time', 'late', 'missing', 'leave', 'exempt', 'makeup'].includes(value) ? value : 'unknown'
        const tasks = list(rows.tasks).filter(r => r.log_id === lr?.id && r.legacy_id !== null && String(r.legacy_id) === key)
        expectRow('submissions', `${p}/status/${pointer(sid)}/${pointer(key)}`, value, { student_id: lookup('students', sid), legacy_student_id: sid, task_id: tasks.length === 1 ? tasks[0].id : null, status, present, assignment_evidence: 'legacy_status_container', teacher_confirmed: null, submitted_at: null })
      }
    })
  })
  entries(settings).forEach(([key, val]) => expectRow('settings_entries', `/data/settings/${pointer(key)}`, val, { key }))
  for (const [table, values, path] of [['products', settings.shop?.products, '/data/settings/shop/products'], ['products', settings.storeItems, '/data/settings/storeItems'], ['jobs', settings.jobs, '/data/settings/jobs'], ['announcements', settings.announcements, '/data/settings/announcements'], ['rules', settings.behaviorRules, '/data/settings/behaviorRules']]) recordList(values).forEach((v, i) => expectRow(table, `${path}/${i}`, v, { legacy_id: v.id ?? null }))
  entries(settings.jobAssignments).forEach(([job, ids]) => list(ids).forEach((sid, i) => expectRow('job_assignments', `/data/settings/jobAssignments/${pointer(job)}/${i}`, sid, { job_id: lookup('jobs', job), student_id: lookup('students', sid) })))
  if (settings.dailyDuty !== undefined) expectRow('daily_duties', '/data/settings/dailyDuty', settings.dailyDuty)
  entries(settings.seatingChart?.grid).forEach(([coord, sid]) => expectRow('seats', `/data/settings/seatingChart/grid/${pointer(coord)}`, sid, { coordinate: coord, student_id: lookup('students', sid) }))
  entries(settings.groupAliases).forEach(([key, val]) => expectRow('groups', `/data/settings/groupAliases/${pointer(key)}`, val, { group_key: key }))
  entries(settings.semesterPeriods).forEach(([key, val]) => expectRow('semesters', `/data/settings/semesterPeriods/${pointer(key)}`, val, { period_key: key }))
  for (const table of TABLES.filter(t => t !== 'legacy_ids')) {
    diff(`${table}/source_paths`, (expected.get(table) || []).sort(), list(rows[table]).map(r => r.source_path).sort())
    const all = list(rows[table])
    diff(`${table}/unique_ids`, all.length, new Set(all.map(r => r.id)).size)
    for (const r of all) {
      diff(`${table}${r.source_path}/batch_id`, batchId, r.batch_id)
      diff(`${table}${r.source_path}/class_id`, classId, r.class_id)
      const id = table === 'classes' ? classId : table === 'migration_batches' ? batchId : digest([classKey, table, r.source_path, r.legacy_id])
      diff(`${table}${r.source_path}/id`, id, r.id)
    }
  }
  const targets = Object.entries(rows).filter(([t]) => !['legacy_ids', 'migration_batches', 'migration_sources'].includes(t)).flatMap(([table, records]) => list(records).map(r => ({ table, r })))
  diff('legacy_ids/count', targets.length, list(rows.legacy_ids).length)
  for (const { table, r } of targets) {
    const mappings = list(rows.legacy_ids).filter(m => m.table_name === table && m.target_id === r.id)
    diff(`legacy_ids/${r.id}/count`, 1, mappings.length)
    if (mappings.length === 1) diff(`legacy_ids/${r.id}`, { id: digest(['map', r.id]), batch_id: batchId, class_id: classId, legacy_id: r.legacy_id, source_path: r.source_path, raw: null, table_name: table, target_id: r.id }, mappings[0])
  }
  return { matches: differences.length === 0, differences, students, source_errors: sourceErrors, ready_for_import: differences.length === 0 && sourceErrors.length === 0 }
}
