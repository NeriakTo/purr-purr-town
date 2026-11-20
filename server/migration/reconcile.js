import { validateSource, orderedErrors } from "./source-validation.js"
import { correctionCycleMembers, correctionTargets } from "./corrections.js"
import { isDeepStrictEqual } from 'node:util'
import {
  accountFields, legacyTransactionFacts, openingAdjustmentFields, openingAdjustmentRaw, sumNumeric, transactionFields,
} from './ledger.js'
import { CONVERTER_VERSION, digest, pointer, migrationBatchId, TABLES } from './convert.js'
import { decisionInputError, resolveCurrentSemester, selectedSemester, taipeiDay } from './decisions.js'

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

function periodSkipReasons(errors, studentPath) {
  return [...new Set(errors.filter(error => {
    if (!error.path.startsWith(`${studentPath}/bank/transactions/`)) return false
    return ['AMBIGUOUS_REFERENCE', 'CORRECTION_CYCLE'].includes(error.code)
  }).map(error => error.code))]
}

function projectTransactions(transactions) {
  const byId = new Map(transactions.map(transaction => [transaction.id, transaction]))
  return transactions.filter(transaction => transaction.kind !== 'migration_opening_adjustment').map(transaction => {
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

function checkAccountTotals(path, account, transactions, diff) {
  const amountSum = sumNumeric(transactions.map(transaction => transaction.amount))
  const earnedSum = sumNumeric(transactions.map(transaction => transaction.earned_delta))
  diff(`${path}/amount_sum_vs_balance`, account?.balance, amountSum)
  diff(`${path}/earned_delta_sum_vs_total`, account?.total_earned, earnedSum)
}

function reachableRoot(correction, byId) {
  const visited = new Set()
  let row = correction
  while (row?.kind === 'correction') {
    if (visited.has(row.id)) return null
    visited.add(row.id)
    row = byId.get(row.corrected_transaction_id)
  }
  if (['legacy_general', 'shop_purchase', 'item_use'].includes(row?.kind)) return row
  return null
}

function checkTransactionInvariants(path, transactions, diff) {
  const byId = new Map(transactions.map(row => [row.id, row]))
  let adjustmentCount = 0
  for (const row of transactions) {
    const rowPath = row.source_path
    diff(`${rowPath}/chain_broken_kind`, row.kind === 'legacy_orphan_correction', row.chain_broken)
    if (row.kind === 'migration_opening_adjustment') {
      adjustmentCount += 1
      diff(`${rowPath}/opening_adjustment_effective_at`, null, row.effective_at)
    }
    if (row.kind === 'correction') {
      const root = reachableRoot(row, byId)
      diff(`${rowPath}/correction_root`, true, root !== null && root.id === row.root_transaction_id)
      if (root) {
        diff(`${rowPath}/root_effective_at`, root.effective_at, row.effective_at)
        diff(`${rowPath}/root_semester`, root.semester, row.semester)
      }
    }
  }
  diff(`${path}/opening_adjustment_count`, Math.min(adjustmentCount, 1), adjustmentCount)
}

function inPeriod(day, { startDate, endDate }) {
  if (day === null) return false
  if (startDate && day < startDate) return false
  return !endDate || day <= endDate
}

function periodTotal(transactions, bounds) {
  const values = transactions.filter(row => inPeriod(row.day, bounds)).map(row => row.earnedDelta)
  return sumNumeric(values)
}

function comparePeriods(path, periodSettings, { source, sourceFacts, converted, validAmounts, skipLegacy }, diff) {
  const periods = []
  const comparison = []
  const legacyProjection = skipLegacy ? [] : projectTransactions(converted)
  const sourceDays = sourceFacts.map(fact => ({ day: taipeiDay(fact.effectiveAt), earnedDelta: fact.earnedDelta }))
  const convertedDays = converted.map(row => ({ day: taipeiDay(row.effective_at), earnedDelta: row.earned_delta }))
  for (const [period, bounds] of entries(periodSettings)) {
    const options = { startDate: bounds?.start || undefined, endDate: bounds?.end || undefined }
    let legacy = null
    if (!skipLegacy) {
      legacy = validAmounts ? legacyEarned(source, options) : null
      const projected = validAmounts ? legacyEarned(legacyProjection, options) : null
      diff(`${path}/period/${period}`, legacy, projected)
      periods.push([period, legacy])
    }
    const current = periodTotal(convertedDays, options)
    diff(`${path}/new_period/${period}`, periodTotal(sourceDays, options), current)
    const difference = numeric(legacy) && numeric(current) ? current - legacy : null
    comparison.push([period, { legacy, current, difference }])
  }
  return { periods: Object.fromEntries(periods), comparison: Object.fromEntries(comparison) }
}

function checkImportedSubmissions(imported, convertedRows, diff) {
  if (!Array.isArray(imported)) {
    diff('imported_submissions/input', '陣列', imported)
    return
  }
  const expected = new Map(convertedRows.map(row => [row.source_path, row.id]))
  diff('imported_submissions/source_paths', [...expected.keys()].sort(), imported.map(row => row?.source_path).sort())
  for (const row of imported) {
    const path = `imported_submissions${row?.source_path}`
    diff(`${path}/id`, expected.get(row?.source_path), row?.id)
    diff(`${path}/rev`, 1, row?.rev)
    diff(`${path}/basis_rev`, 1, row?.basis_rev)
    diff(`${path}/assignment_active`, true, row?.assignment_active)
  }
}

export function reconcile(source, converted, { decisions: expectedDecisions, importedSubmissions } = {}) {
  source = source ?? null
  const periodSkipped = [], notices = [], openingAdjustments = []
  const differences = [], students = [], rows = converted?.rows || {}, expected = new Map()
  const diff = (path, expected, actual) => { if (!isDeepStrictEqual(expected, actual)) differences.push({ path, expected, actual }) }
  const storedDecisions = list(rows.migration_batches)[0]?.decisions
  const issue = decisionInputError(storedDecisions)
  if (issue) diff('migration_batches/decisions/input', '有效的轉換決定', issue)
  const decisions = issue ? {} : storedDecisions
  if (expectedDecisions !== undefined) diff('migration_batches/decisions', expectedDecisions, storedDecisions)
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
  const classId = digest(['class', classKey]), batchId = migrationBatchId(classKey, source, decisions)
  const sourceErrors = validateSource(source, legacyEarned, { notices, openingAdjustments, decisions })
  diff("report/notices", orderedErrors(notices), orderedErrors(converted?.report?.notices))
  diff("report/opening_adjustments", openingAdjustments, converted?.report?.opening_adjustments)
  diff("errors", orderedErrors(sourceErrors), orderedErrors(converted?.errors))
  expectRow('migration_batches', '', null, {
    id: batchId, source_hash: digest(source), import_rules_enabled: false,
    converter_version: CONVERTER_VERSION, validation_errors: sourceErrors,
    cutover_date: typeof decisions.cutoverDate === 'string' ? decisions.cutoverDate : null,
  })
  expectRow('migration_sources', '', source)
  const currentSemester = resolveCurrentSemester(settings.currentSemester, data.updatedAt, decisions)
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
    const correctionEdges = correctionTargets(txs)
    const cycleMembers = correctionCycleMembers(correctionEdges)
    const facts = legacyTransactionFacts(txs, correctionEdges, cycleMembers)
    const account = accountFields(bank, txs, facts, earned)
    const balance = account.balance
    const total = account.total_earned
    const accountPath = `${p}/bank`
    const actualAccount = expectRow('accounts', accountPath, s.bank, {
      ...account, student_id: sr?.id,
      balance: numeric(balance) ? balance : null,
      total_earned: numeric(total) ? total : null,
    })
    const actualTxs = list(rows.transactions).filter(t => t.student_id === sr?.id)
    const adjustment = openingAdjustments.find(item => item.path === accountPath)
    diff(`${p}/transaction_count`, txs.length + (adjustment ? 1 : 0), actualTxs.length)
    function transactionIdAt(index) {
      return one('transactions', `${p}/bank/transactions/${index}`)?.id ?? null
    }
    txs.forEach((t, j) => {
      const targetIndex = correctionEdges.get(j)
      const targetRow = targetIndex === null ? null : one("transactions", `${p}/bank/transactions/${targetIndex}`)
      expectRow('transactions', `${p}/bank/transactions/${j}`, t, { student_id: sr?.id, legacy_id: t.id ?? null, amount: numeric(t.amount) ? t.amount : null, reason: t.reason ?? null, occurred_at: t.date ?? null, balance_after: t.balance ?? null, voided: Boolean(t.voided), transaction_type: t.type ?? 'legacy', corrected_transaction_id: t.correctedTxId === undefined || cycleMembers.has(j) ? null : targetRow?.id ?? null, legacy_semantics: true, ...transactionFields(facts[j], transactionIdAt, decisions) })
    })
    if (adjustment) {
      const fields = openingAdjustmentFields(adjustment, decisions.cutoverDate, sr?.id)
      expectRow('transactions', accountPath, openingAdjustmentRaw(account), fields)
    }
    if (decisions.openingAdjustment === true) checkAccountTotals(p, actualAccount, actualTxs, diff)
    checkTransactionInvariants(p, actualTxs, diff)
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
    const skipReasons = periodSkipReasons(sourceErrors, p)
    for (const reason of skipReasons) periodSkipped.push({ path: p, reason })
    const { periods, comparison } = comparePeriods(p, settings.semesterPeriods, {
      source: txs, sourceFacts: facts, converted: actualTxs, validAmounts: valid, skipLegacy: skipReasons.length > 0,
    }, diff)
    students.push({ legacy_id: s.id || s.uuid || null, balance, total_earned: total, transaction_count: txs.length, correction_edges: txs.filter(t => t.correctedTxId !== undefined).map(t => [t.id, t.correctedTxId]), inventory_count: recordList(s.inventory).length, usage_count: usages, comment_semesters: entries(s.comments).map(([sem]) => sem), periods, period_comparison: comparison })
  })
  recordList(data.logs).forEach((log, i) => {
    const p = `/data/logs/${i}`, lr = expectRow('logs', p, log)
    recordList(log.tasks).forEach((t, j) => expectRow('tasks', `${p}/tasks/${j}`, t, { legacy_id: t.id ?? null, log_id: lr?.id, title: t.title ?? null, task_type: t.type ?? null, published_on: t.createdAt ?? log.date ?? null, due_on: t.dueDate ?? log.date ?? null, semester: selectedSemester(t.createdAt ?? log.date, decisions), correction_state: t.type === '訂正' ? 'legacy_unlinked' : null, original_task_id: null, teacher_confirmed: null, assignees_known: false }))
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
  if (importedSubmissions !== undefined) checkImportedSubmissions(importedSubmissions, list(rows.submissions), diff)
  return { matches: differences.length === 0, differences, students, notices, opening_adjustments: openingAdjustments, period_skipped: periodSkipped, source_errors: sourceErrors, ready_for_import: differences.length === 0 && sourceErrors.length === 0 }
}
