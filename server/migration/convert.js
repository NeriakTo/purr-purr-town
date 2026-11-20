import { correctionCycleMembers, correctionMatches, correctionTargets } from "./corrections.js"
import { createHash } from 'node:crypto'
import {
  accountFields, legacyTransactionFacts, openingAdjustmentFields, openingAdjustmentFor,
  openingAdjustmentRaw, reportAccountDrift, transactionFields, validateTransactionDate,
} from './ledger.js'
import { openingAdjustmentEnabled, requireDecisions, resolveCurrentSemester, selectedSemester, validateTaskDate } from './decisions.js'

export const TABLES = ['migration_batches', 'migration_sources', 'legacy_ids', 'classes', 'students', 'accounts', 'transactions', 'inventory_items', 'comments', 'exempt_rules', 'logs', 'tasks', 'submissions', 'settings_entries', 'products', 'jobs', 'job_assignments', 'daily_duties', 'seats', 'announcements', 'rules', 'groups', 'semesters']
export const pointer = v => String(v).replaceAll('~', '~0').replaceAll('/', '~1')
export function canonicalJson(value) {
  return JSON.stringify(value === undefined ? null : value, function sortedKeys(key, item) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
  })
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const numeric = v => typeof v === 'number' && Number.isFinite(v)
const store = r => typeof r === 'string' && (r.startsWith('購買') || r.startsWith('使用道具'))
export const statusOf = v => v === true ? 'on_time' : v === false || v === undefined ? 'pending' : ['on_time', 'late', 'missing', 'leave', 'exempt', 'makeup'].includes(v) ? v : 'unknown'
export { semesterAt } from './decisions.js'
export const CONVERTER_VERSION = 'v2-1A-r3'

export function migrationBatchId(classKey, source, decisions) {
  return digest([CONVERTER_VERSION, classKey, source, decisions])
}

export function convert(input, { decisions = {} } = {}) {
  requireDecisions(decisions)
  const source = structuredClone(input ?? null)
  const rows = Object.fromEntries(TABLES.map(t => [t, []])), errors = [], notices = [], openingAdjustments = []
  const error = (code, path, value = null) => errors.push({ code, path, value: structuredClone(value) })
  const notice = (code, path, value = null) => notices.push({ code, path, value: structuredClone(value) })
  const arr = (v, p) => {
    if (v === undefined) return []
    if (!Array.isArray(v)) { error('INVALID_ARRAY', p, v); return [] }
    if (!/\/(students|logs|tasks|transactions|inventory|products|storeItems|jobs|announcements|behaviorRules|ruleCategories|customObjects)$/.test(p)) return v
    return v.map((item, i) => { if (isObject(item)) return item; error('INVALID_RECORD', `${p}/${i}`, item); return {} })
  }
  const obj = (v, p) => { if (v === undefined) return {}; if (isObject(v)) return v; error('INVALID_OBJECT', p, v); return {} }
  const check = (v, p, keys) => Object.keys(obj(v, p)).forEach(k => { if (!keys.split(' ').includes(k)) error('UNKNOWN_FIELD', `${p}/${pointer(k)}`, v[k]) })
  const enumeration = (v, choices, code, path) => { if (v !== undefined && !choices.includes(v)) error(code, path, v) }
  const data = obj(source?.data, '/data'), settings = obj(data.settings, '/data/settings')
  const classKey = source?.classId ?? data.classId ?? null
  if (typeof classKey !== 'string' || !classKey) error('INVALID_CLASS_ID', '/classId', classKey)
  if (source?.classId !== data.classId) error('CLASS_ID_CONFLICT', '/data/classId', data.classId)
  const classId = digest(['class', classKey]), batchId = migrationBatchId(classKey, source, decisions)
  const add = (table, path, raw, fields = {}, legacy = null) => {
    const row = { id: digest([classKey, table, path, legacy]), batch_id: batchId, class_id: classId, legacy_id: legacy, source_path: path, raw: raw === undefined ? null : structuredClone(raw), ...fields }
    rows[table].push(row)
    if (!['legacy_ids', 'migration_sources', 'migration_batches'].includes(table)) rows.legacy_ids.push({ id: digest(['map', row.id]), batch_id: batchId, class_id: classId, legacy_id: legacy, source_path: path, raw: null, table_name: table, target_id: row.id })
    return row
  }
  const index = (list, path) => {
    const map = new Map()
    for (const r of list) {
      if (r.legacy_id === null) { error('MISSING_LEGACY_ID', r.source_path); continue }
      const key = String(r.legacy_id)
      if (map.has(key)) { error('DUPLICATE_LEGACY_ID', path, r.legacy_id); map.get(key).push(r) }
      else map.set(key, [r])
    }
    return map
  }
  const ref = (map, legacy, code, path) => {
    const found = map.get(String(legacy)) || []
    if (found.length !== 1) { error(found.length ? 'AMBIGUOUS_REFERENCE' : code, path, legacy); return null }
    return found[0].id
  }
  add('migration_batches', '', null, {
    id: batchId, source_hash: digest(source), converter_version: CONVERTER_VERSION, import_rules_enabled: false,
    decisions: structuredClone(decisions),
    cutover_date: typeof decisions.cutoverDate === 'string' ? decisions.cutoverDate : null,
  })
  add('migration_sources', '', source)
  check(source, '', 'classId className data')
  check(data, '/data', 'classId className teacher students logs settings updatedAt')
  check(settings, '/data/settings', 'currentSemester taskTypes groupAliases announcements jobs behaviorRules shop currency ruleCategories jobAssignments automation seatingChart semesterPeriods dailyDuty dutyJobId storeItems currencyRates')
  const currentSemester = resolveCurrentSemester(settings.currentSemester, data.updatedAt, decisions, error)
  add('classes', '/data', data, { id: classId, name: data.className ?? source?.className ?? null, teacher: data.teacher ?? null, current_semester: currentSemester }, classKey)
  const students = arr(data.students, '/data/students')
  const studentRows = students.map((s, i) => {
    const path = `/data/students/${i}`
    check(s, path, 'id uuid name number seatNumber group gender avatar inactive bank inventory comments taskExemptRules')
    if (s.inactive !== undefined && typeof s.inactive !== 'boolean') error('UNKNOWN_ENROLLMENT', `${path}/inactive`, s.inactive)
    return add('students', path, s, { name: s.name ?? null, seat_number: s.number ?? null, group_key: s.group == null ? null : String(s.group), avatar: s.avatar ?? null, enrollment_status: typeof s.inactive === 'boolean' || s.inactive === undefined ? (s.inactive ? 'home_study' : 'enrolled') : 'unknown' }, s.id || s.uuid || null)
  })
  const sm = index(studentRows, '/data/students')
  const products = []
  for (const [list, path] of [[settings.shop?.products, '/data/settings/shop/products'], [settings.storeItems, '/data/settings/storeItems']]) arr(list, path).forEach((p, i) => {
    check(p, `${path}/${i}`, 'id name icon price priceUnit stock initialStock description')
    enumeration(p.priceUnit, ['point', 'fish', 'cookie'], 'UNKNOWN_PRICE_UNIT', `${path}/${i}/priceUnit`)
    products.push(add('products', `${path}/${i}`, p, {}, p.id ?? null))
  })
  const pm = index(products, '/data/settings/shop/products')
  students.forEach((s, i) => {
    const p = `/data/students/${i}`, sid = studentRows[i].id
    const bank = obj(s.bank, `${p}/bank`)
    check(bank, `${p}/bank`, 'balance totalEarned transactions')
    const txs = arr(bank.transactions, `${p}/bank/transactions`)
    const tr = txs.map((t, j) => {
      const path = `${p}/bank/transactions/${j}`
      check(t, path, 'id date amount reason balance type correctedTxId voided excludeFromTotal')
      if (!numeric(t.amount)) error('INVALID_AMOUNT', `${path}/amount`, t.amount)
      if (t.reason !== undefined && typeof t.reason !== 'string') error('INVALID_REASON', `${path}/reason`, t.reason)
      if (t.type !== undefined && t.type !== 'correction') error('UNKNOWN_TRANSACTION_TYPE', `${path}/type`, t.type)
      if (t.voided !== undefined && typeof t.voided !== 'boolean') error('UNKNOWN_VOIDED', `${path}/voided`, t.voided)
      validateTransactionDate(t.date, decisions, path, error)
      return add('transactions', path, t, { student_id: sid, amount: numeric(t.amount) ? t.amount : null, reason: t.reason ?? null, occurred_at: t.date ?? null, balance_after: t.balance ?? null, voided: Boolean(t.voided), transaction_type: t.type ?? 'legacy', corrected_transaction_id: null, legacy_semantics: true }, t.id ?? null)
    })
    index(tr, `${p}/bank/transactions`)
    const edges = correctionTargets(txs)
    const cycles = correctionCycleMembers(edges)
    const facts = legacyTransactionFacts(txs, edges, cycles)
    tr.forEach((r, j) => {
      const target = txs[j].correctedTxId
      const matches = correctionMatches(txs, target)
      if (target !== undefined && matches.length !== 1) {
        error(matches.length ? "AMBIGUOUS_REFERENCE" : "ORPHAN_CORRECTION", `${r.source_path}/correctedTxId`, target)
      }
      if (r.transaction_type === "correction" && target === undefined) error("ORPHAN_CORRECTION", r.source_path)
      if (cycles.has(j)) error("CORRECTION_CYCLE", r.source_path, target)
      const targetIndex = edges.get(j)
      r.corrected_transaction_id = cycles.has(j) || targetIndex === null ? null : tr[targetIndex].id
      Object.assign(r, transactionFields(facts[j], index => tr[index].id, decisions))
    })
    const valid = txs.every(t => numeric(t.amount))
    if (valid) {
      let running = 0
      txs.forEach(function checkRunningBalance(t, j) {
        running += t.amount
        if (t.balance === undefined || t.balance === running) return
        notice('TRANSACTION_BALANCE_DRIFT', `${p}/bank/transactions/${j}/balance`, { stored: t.balance, computed_from_zero: running })
      })
    }
    const txMap = Object.fromEntries(txs.map(t => [t.id, t]))
    const earned = valid ? txs.filter(t => !t.voided && !store(t.reason) && !(t.type === 'correction' && t.correctedTxId && store(txMap[t.correctedTxId]?.reason))).reduce((sum, t) => sum + t.amount, 0) : null
    const accountPath = `${p}/bank`
    const account = accountFields(bank, txs, facts, earned)
    if (!numeric(account.balance)) error('INVALID_BALANCE', `${accountPath}/balance`, account.balance)
    if (!numeric(account.total_earned)) error('INVALID_TOTAL_EARNED', `${accountPath}/totalEarned`, account.total_earned)
    add('accounts', accountPath, s.bank, {
      ...account, student_id: sid,
      balance: numeric(account.balance) ? account.balance : null,
      total_earned: numeric(account.total_earned) ? account.total_earned : null,
    })
    const adjustmentEnabled = openingAdjustmentEnabled(decisions)
    reportAccountDrift(accountPath, account, adjustmentEnabled, error, notice)
    if (adjustmentEnabled) {
      const adjustment = openingAdjustmentFor(accountPath, account)
      if (adjustment) {
        openingAdjustments.push(adjustment)
        const fields = openingAdjustmentFields(adjustment, decisions.cutoverDate, sid)
        add('transactions', accountPath, openingAdjustmentRaw(account), fields)
      }
    }
    arr(s.inventory, `${p}/inventory`).forEach((item, j) => {
      check(item, `${p}/inventory/${j}`, 'itemId name icon purchasedAt')
      add('inventory_items', `${p}/inventory/${j}`, item, { student_id: sid, product_id: ref(pm, item.itemId, 'ORPHAN_PRODUCT', `${p}/inventory/${j}/itemId`), legacy_index: j, purchase_transaction_id: null, consumed: false }, item.itemId ?? null)
    })
    Object.entries(obj(s.comments, `${p}/comments`)).forEach(([sem, c]) => {
      check(c, `${p}/comments/${pointer(sem)}`, 'rawComment polishedComment motto analysis locked lockedComment lockedMotto status errorMessage generatedAt updatedAt modelUsed')
      add('comments', `${p}/comments/${pointer(sem)}`, c, { student_id: sid, semester: sem, locked_comment: c?.lockedComment ?? c?.locked ?? false, locked_motto: c?.lockedMotto ?? c?.locked ?? false })
      for (const lock of ['locked', 'lockedComment', 'lockedMotto']) if (c?.[lock] !== undefined && typeof c[lock] !== 'boolean') error('INVALID_LOCK', `${p}/comments/${pointer(sem)}/${lock}`, c[lock])
      if (!/^\d+-[12]$/.test(sem)) error('UNKNOWN_COMMENT_SEMESTER', `${p}/comments/${pointer(sem)}`, sem)
      enumeration(c?.status, ['idle', 'generating', 'done', 'error'], 'UNKNOWN_COMMENT_STATUS', `${p}/comments/${pointer(sem)}/status`)
    })
    if (s.taskExemptRules !== undefined) {
      if (Array.isArray(s.taskExemptRules)) s.taskExemptRules.forEach((rule, j) => { check(rule, `${p}/taskExemptRules/${j}`, 'keyword taskType'); add('exempt_rules', `${p}/taskExemptRules/${j}`, rule, { student_id: sid }) })
      else { check(s.taskExemptRules, `${p}/taskExemptRules`, 'keywords taskTypes'); add('exempt_rules', `${p}/taskExemptRules`, s.taskExemptRules, { student_id: sid }) }
    }
  })
  arr(data.logs, '/data/logs').forEach((log, i) => {
    const p = `/data/logs/${i}`
    check(log, p, 'date tasks status')
    const lr = add('logs', p, log)
    const tasks = arr(log.tasks, `${p}/tasks`).map((t, j) => {
      check(t, `${p}/tasks/${j}`, 'id title type createdAt dueDate')
      enumeration(t.type, [...arr(settings.taskTypes, '/data/settings/taskTypes'), '作業', '訂正', '攜帶物品', '考試', '通知單', '回條'], 'UNKNOWN_TASK_TYPE', `${p}/tasks/${j}/type`)
      validateTaskDate(t.createdAt ?? log.date, decisions, `${p}/tasks/${j}`, error)
      notice('UNKNOWN_ASSIGNMENT_LIST', `${p}/tasks/${j}`)
      return add('tasks', `${p}/tasks/${j}`, t, { log_id: lr.id, title: t.title ?? null, task_type: t.type ?? null, published_on: t.createdAt ?? log.date ?? null, due_on: t.dueDate ?? log.date ?? null, semester: selectedSemester(t.createdAt ?? log.date, decisions), correction_state: t.type === '訂正' ? 'legacy_unlinked' : null, original_task_id: null, teacher_confirmed: null, assignees_known: false }, t.id ?? null)
    })
    const tm = index(tasks, `${p}/tasks`)
    Object.entries(obj(log.status, `${p}/status`)).forEach(([legacySid, values]) => {
      const sp = `${p}/status/${pointer(legacySid)}`, sid = ref(sm, legacySid, 'ORPHAN_STUDENT', sp), vals = obj(values, sp)
      const keys = [...new Set([...tasks.filter(t => t.legacy_id !== null).map(t => String(t.legacy_id)), ...Object.keys(vals)])]
      keys.forEach(key => {
        const present = Object.hasOwn(vals, key), value = vals[key], path = `${sp}/${pointer(key)}`, status = statusOf(value)
        if (status === 'unknown') error('UNKNOWN_STATUS', path, value)
        add('submissions', path, value, { student_id: sid, legacy_student_id: legacySid, task_id: ref(tm, key, 'ORPHAN_TASK', path), status, present, assignment_evidence: 'legacy_status_container', teacher_confirmed: null, submitted_at: null }, key)
      })
    })
  })
  Object.entries(settings).forEach(([key, value]) => add('settings_entries', `/data/settings/${pointer(key)}`, value, { key }))
  const jobs = arr(settings.jobs, '/data/settings/jobs').map((job, i) => {
    const p = `/data/settings/jobs/${i}`
    check(job, p, 'id title salary icon cycle category')
    enumeration(job.cycle, ['daily', 'weekly', 'monthly', 'semester', 'once'], 'UNKNOWN_JOB_CYCLE', `${p}/cycle`)
    enumeration(job.category, ['cadre', 'cleaning', 'other'], 'UNKNOWN_JOB_CATEGORY', `${p}/category`)
    return add('jobs', p, job, {}, job.id ?? null)
  })
  const jm = index(jobs, '/data/settings/jobs')
  Object.entries(obj(settings.jobAssignments, '/data/settings/jobAssignments')).forEach(([job, ids]) => arr(ids, `/data/settings/jobAssignments/${pointer(job)}`).forEach((sid, i) => {
    const p = `/data/settings/jobAssignments/${pointer(job)}/${i}`
    add('job_assignments', p, sid, { job_id: ref(jm, job, 'ORPHAN_JOB', p), student_id: ref(sm, sid, 'ORPHAN_STUDENT', p) })
  }))
  if (settings.dutyJobId !== undefined && settings.dutyJobId !== null) ref(jm, settings.dutyJobId, 'ORPHAN_JOB', '/data/settings/dutyJobId')
  if (settings.dailyDuty !== undefined) {
    check(settings.dailyDuty, '/data/settings/dailyDuty', 'date studentIds paid')
    add('daily_duties', '/data/settings/dailyDuty', settings.dailyDuty)
    arr(settings.dailyDuty?.studentIds, '/data/settings/dailyDuty/studentIds').forEach((sid, i) => ref(sm, sid, 'ORPHAN_STUDENT', `/data/settings/dailyDuty/studentIds/${i}`))
  }
  if (settings.seatingChart !== undefined) {
    check(settings.seatingChart, '/data/settings/seatingChart', 'rows cols grid objects customObjects perspective')
    Object.entries(obj(settings.seatingChart?.grid, '/data/settings/seatingChart/grid')).forEach(([coord, sid]) => {
      const p = `/data/settings/seatingChart/grid/${pointer(coord)}`
      add('seats', p, sid, { coordinate: coord, student_id: ref(sm, sid, 'ORPHAN_STUDENT', p) })
    })
    arr(settings.seatingChart?.customObjects, '/data/settings/seatingChart/customObjects').forEach((v, i) => check(v, `/data/settings/seatingChart/customObjects/${i}`, 'id name label icon color'))
  }
  for (const [key, table, fields] of [['announcements', 'announcements', 'id text color rotate'], ['behaviorRules', 'rules', 'id label amount type icon category']]) arr(settings[key], `/data/settings/${key}`).forEach((v, i) => { check(v, `/data/settings/${key}/${i}`, fields); add(table, `/data/settings/${key}/${i}`, v, {}, v.id ?? null) })
  Object.entries(obj(settings.groupAliases, '/data/settings/groupAliases')).forEach(([key, val]) => add('groups', `/data/settings/groupAliases/${pointer(key)}`, val, { group_key: key }, key))
  Object.entries(obj(settings.semesterPeriods, '/data/settings/semesterPeriods')).forEach(([key, val]) => { check(val, `/data/settings/semesterPeriods/${pointer(key)}`, 'start end'); add('semesters', `/data/settings/semesterPeriods/${pointer(key)}`, val, { period_key: key }) })
  for (const [key, fields] of [['automation', 'dailyQuestBonus latePenalty missingPenalty'], ['shop', 'name icon products'], ['currency', 'base tier1 tier2'], ['currencyRates', 'fish cookie']]) if (settings[key] !== undefined) check(settings[key], `/data/settings/${key}`, fields)
  for (const key of ['base', 'tier1', 'tier2']) if (settings.currency?.[key] !== undefined) check(settings.currency[key], `/data/settings/currency/${key}`, 'name icon rate')
  arr(settings.ruleCategories, '/data/settings/ruleCategories').forEach((v, i) => check(v, `/data/settings/ruleCategories/${i}`, 'id name icon'))
  rows.migration_batches[0].validation_errors = structuredClone(errors)
  return { rows, errors, report: { converter_version: CONVERTER_VERSION, source_hash: digest(source), notices, opening_adjustments: openingAdjustments, row_counts: Object.fromEntries(Object.entries(rows).map(([t, list]) => [t, list.length])), error_count: errors.length, ready_for_import: errors.length === 0, rules_triggered: 0 } }
}
