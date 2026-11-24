import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { convert } from './convert.js'
import { decisionInputError, snapshotOnlyOrphanTaskStatus, validCutoverDate } from './decisions.js'
import { reconcile } from './reconcile.js'

function summarizeDecisions(decisions) {
  const summary = {}
  if (validCutoverDate(decisions.cutoverDate)) summary.cutoverDate = decisions.cutoverDate
  if (typeof decisions.openingAdjustment === 'boolean') summary.openingAdjustment = decisions.openingAdjustment
  if (decisions.semesterRule === 'month') summary.semesterRule = decisions.semesterRule
  if (snapshotOnlyOrphanTaskStatus(decisions)) summary.orphanTaskStatus = decisions.orphanTaskStatus
  return summary
}

function countByCode(entries) {
  const counts = {}
  for (const { code } of entries) counts[code] = (counts[code] ?? 0) + 1
  return counts
}

function compareText(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function summarizeOrphanStatuses(notices) {
  const groups = new Map()
  for (const { code, value } of notices) {
    if (code !== 'ORPHAN_TASK_STATUS') continue
    const { task_key, status } = value
    const day = typeof value.day === 'string' ? value.day : null
    const key = JSON.stringify([day, task_key])
    if (!groups.has(key)) groups.set(key, { day, task_key, count: 0, by_status: {} })
    const group = groups.get(key)
    group.count += 1
    group.by_status[status] = (group.by_status[status] ?? 0) + 1
  }
  return [...groups.values()].sort((a, b) =>
    compareText(a.day ?? '', b.day ?? '') || compareText(a.task_key, b.task_key))
}

function hasSeatNumber(value) {
  return value != null && value !== ''
}

function summarizeSeatNumbers(students) {
  const coverage = { with_number: 0, seat_number_only: 0, neither: 0 }
  const pathsByNumber = new Map()
  students.forEach((student, index) => {
    if (hasSeatNumber(student?.number)) {
      coverage.with_number += 1
      const seatNumber = String(student.number).trim()
      if (!pathsByNumber.has(seatNumber)) pathsByNumber.set(seatNumber, [])
      pathsByNumber.get(seatNumber).push(`/data/students/${index}`)
    } else if (hasSeatNumber(student?.seatNumber)) {
      coverage.seat_number_only += 1
    } else {
      coverage.neither += 1
    }
  })
  const duplicates = [...pathsByNumber]
    .filter(([, paths]) => paths.length > 1)
    .map(([seat_number, student_paths]) => ({ seat_number, student_paths }))
  return { coverage, duplicates }
}

function summarizeReconciliation(audit) {
  return {
    matches: audit.matches,
    difference_count: audit.differences.length,
    difference_paths: audit.differences.slice(0, 50).map(({ path }) => path),
    period_skipped_count: audit.period_skipped.length,
    ready_for_import: audit.ready_for_import,
  }
}

export function summarizeTrial(source, decisions) {
  const converted = convert(source, { decisions })
  const audit = reconcile(source, converted)
  const { report } = converted
  const batch = converted.rows.migration_batches[0]
  const students = source?.data?.students
  const seats = summarizeSeatNumbers(Array.isArray(students) ? students : [])
  return {
    converter_version: batch.converter_version,
    batch_id: batch.id,
    decisions: summarizeDecisions(batch.decisions),
    row_counts: report.row_counts,
    error_counts: countByCode(converted.errors),
    notice_counts: countByCode(report.notices),
    orphan_task_statuses: summarizeOrphanStatuses(report.notices),
    duplicate_seat_numbers: seats.duplicates,
    seat_number_coverage: seats.coverage,
    opening_adjustments: report.opening_adjustments.map(({ path, amount, earned_delta }) => ({ path, amount, earned_delta })),
    convert_ready: report.ready_for_import,
    reconcile: summarizeReconciliation(audit),
  }
}

function cliDecisionError(decisions) {
  const issue = decisionInputError(decisions)
  if (issue) return issue
  if (Object.hasOwn(decisions, 'cutoverDate') && !validCutoverDate(decisions.cutoverDate)) {
    return 'cutoverDate 必須是有效的 YYYY-MM-DD 日期'
  }
  if (Object.hasOwn(decisions, 'openingAdjustment') && typeof decisions.openingAdjustment !== 'boolean') {
    return 'openingAdjustment 必須是布林值'
  }
  if (Object.hasOwn(decisions, 'semesterRule') && decisions.semesterRule !== 'month') {
    return "semesterRule 必須是 'month'"
  }
  return null
}

function cliFailure(reason) {
  process.stderr.write(`${reason}\n`)
  return 2
}

function runCli(args) {
  const [sourcePath, option, decisionsJson] = args
  if (args.length !== 3 || !sourcePath || sourcePath.startsWith('--') || option !== '--decisions') {
    return cliFailure("用法：node server/migration/trial-summary.js <來源檔> --decisions '<JSON>'")
  }

  let decisions
  try {
    decisions = JSON.parse(decisionsJson)
  } catch {
    return cliFailure('--decisions 不是有效的 JSON')
  }
  const issue = cliDecisionError(decisions)
  if (issue) return cliFailure(issue)

  let text
  try {
    text = readFileSync(sourcePath, 'utf8')
  } catch {
    return cliFailure('無法讀取來源檔')
  }
  let source
  try {
    source = JSON.parse(text)
  } catch {
    return cliFailure('來源檔不是有效的 JSON')
  }

  let serialized
  try {
    serialized = JSON.stringify(summarizeTrial(source, decisions), null, 2)
  } catch {
    return cliFailure('無法完成來源轉換與對帳')
  }
  process.stdout.write(`${serialized}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2))
}
