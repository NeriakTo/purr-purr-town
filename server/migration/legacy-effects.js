import { taipeiDay } from './decisions.js'

const events = {
  late: { reason: '作業遲交', refund: '更正：撤銷遲交扣分', penalty: 'latePenalty' },
  missing: { reason: '作業缺交', refund: '更正：撤銷缺交扣分', penalty: 'missingPenalty' },
}
const eventNames = Object.keys(events)
const deductionStatuses = [...eventNames, 'makeup']

export function recordPossibleSubmission(byStudent, studentId, status, orphan) {
  if (studentId === null || !deductionStatuses.includes(status)) return
  if (!byStudent.has(studentId)) byStudent.set(studentId, { late: 0, missing: 0, makeup: 0, orphan: false })
  const evidence = byStudent.get(studentId)
  evidence[status] += 1
  evidence.orphan ||= orphan
}

function transactionEvent(transaction, reasonField) {
  return eventNames.find(event => events[event][reasonField] === transaction.reason)
}

function collectTransactions(transactions, effectiveAmounts) {
  const byStudent = new Map()
  for (const transaction of transactions) {
    const deduction = transactionEvent(transaction, 'reason')
    const refund = transactionEvent(transaction, 'refund')
    const effectiveAmount = effectiveAmounts.get(transaction.id)
    const isCandidate = deduction && transaction.kind === 'legacy_general' && effectiveAmount < 0
    if (!isCandidate && !refund) continue
    if (!byStudent.has(transaction.student_id)) byStudent.set(transaction.student_id, { candidates: [], refunds: [] })
    const evidence = byStudent.get(transaction.student_id)
    if (isCandidate) evidence.candidates.push({ transaction, event: deduction, effectiveAmount })
    if (refund) evidence.refunds.push(refund)
  }
  return byStudent
}

function indexRuleAmounts(rules) {
  const amounts = new Map()
  for (const { raw } of rules) {
    if (!amounts.has(raw.label)) amounts.set(raw.label, [])
    amounts.get(raw.label).push(raw.amount ?? null)
  }
  return amounts
}

function firstUnresolvedReason({ status, taskDay, candidates, refundCount, submissions, possibleCount, automation, ruleAmounts }) {
  if (submissions.orphan) return 'orphan_status'
  const makeup = status === 'makeup'
  if (!makeup && submissions.makeup > 0) return 'has_makeup'
  if ((makeup ? possibleCount : submissions[status]) !== 1) return 'multiple_submissions'
  if (candidates.length === 0) return 'no_candidate'
  if (candidates.length > 1) return 'multiple_candidates'
  if (refundCount > 0) return 'has_refund'
  const [{ transaction, event }] = candidates
  if (transaction.amount !== automation?.[events[event].penalty] || transaction.amount === 0) return 'amount_mismatch'
  const transactionDay = taipeiDay(transaction.occurred_at)
  if (transactionDay === null || taskDay === null) return 'date_unknown'
  if (transactionDay < taskDay) return 'date_before_task'
  if (ruleAmounts.get(transaction.reason)?.includes(transaction.amount)) return 'same_name_rule'
  return null
}

function reportCandidate({ transaction }) {
  return {
    transaction_id: transaction.id,
    date: taipeiDay(transaction.occurred_at),
    amount: transaction.amount,
    reason: transaction.reason,
  }
}

function possibleSubmissions(submissions) {
  return submissions ? submissions.late + submissions.missing + submissions.makeup : 0
}

function reportExcessDeductions(students, transactionsByStudent, submissionsByStudent) {
  return students.flatMap(student => {
    const deductionCount = transactionsByStudent.get(student.id)?.candidates.length ?? 0
    const possibleCount = possibleSubmissions(submissionsByStudent.get(student.id))
    if (deductionCount <= possibleCount) return []
    return [{
      student_id: student.id,
      seat_number: student.seat_number,
      candidate_transactions: deductionCount,
      possible_submissions: possibleCount,
    }]
  })
}

function convertLegacyEffect(submission, task, student, transactions, submissions, automation, ruleAmounts, add) {
  const { status } = submission
  const taskDay = taipeiDay(task.published_on)
  const applicableEvents = status === 'makeup' ? eventNames : [status]
  const candidates = transactions.candidates.filter(candidate => status === 'makeup' || candidate.event === status)
  const refundCount = transactions.refunds.filter(event => status === 'makeup' || event === status).length
  const possibleCount = possibleSubmissions(submissions)
  const reason = firstUnresolvedReason({ status, taskDay, candidates, refundCount, submissions, possibleCount, automation, ruleAmounts })
  const linked = reason === null ? candidates[0] : null
  const fields = {
    submission_id: submission.id,
    student_id: student.id,
    task_id: task.id,
    link_state: linked ? 'candidate' : 'unresolved',
    event: linked ? `submission.${linked.event}` : null,
    transaction_id: linked?.transaction.id ?? null,
    amount_at_link: linked?.effectiveAmount ?? null,
    unresolved_reason: reason,
  }
  add('legacy_effects', submission.source_path, {
    candidate_transactions: transactions.candidates.length,
    refund_transactions: transactions.refunds.length,
    possible_submissions: possibleCount,
  }, fields)
  return {
    submission_id: submission.id,
    link_state: fields.link_state,
    unresolved_reason: reason,
    seat_number: student.seat_number,
    task_title: task.title,
    task_published_on: taskDay,
    candidate_transactions: candidates.map(reportCandidate),
    same_name_rule_amounts: Object.fromEntries(applicableEvents.map(event => {
      const { reason } = events[event]
      return [reason, ruleAmounts.get(reason) ?? '無']
    })),
  }
}

export function buildLegacyEffectReport(rows, submissionsByStudent, effectiveAmounts, automation, add) {
  const transactions = collectTransactions(rows.transactions, effectiveAmounts)
  const ruleAmounts = indexRuleAmounts(rows.rules)
  const students = new Map(rows.students.map(student => [student.id, student]))
  const tasks = new Map(rows.tasks.map(task => [task.id, task]))
  const effects = []
  for (const submission of rows.submissions) {
    if (!submission.present || !deductionStatuses.includes(submission.status)) continue
    if (submission.student_id === null || submission.task_id === null) continue
    const evidence = transactions.get(submission.student_id) ?? { candidates: [], refunds: [] }
    effects.push(convertLegacyEffect(submission, tasks.get(submission.task_id), students.get(submission.student_id),
      evidence, submissionsByStudent.get(submission.student_id), automation, ruleAmounts, add))
  }
  return {
    legacy_effects: effects,
    excess_legacy_deductions: reportExcessDeductions(rows.students, transactions, submissionsByStudent),
  }
}
