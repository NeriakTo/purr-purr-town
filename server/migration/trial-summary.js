import { convert } from './convert.js'
import { snapshotOnlyOrphanTaskStatus, validCutoverDate } from './decisions.js'
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
