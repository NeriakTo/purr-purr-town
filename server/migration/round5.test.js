import { expect, it } from 'vitest'
import { convert } from './convert.js'
import { reconcile } from './reconcile.js'

const decisions = { semesterRule: 'month' }
const late = '作業遲交'
const missing = '作業缺交'
const lateRefund = '更正：撤銷遲交扣分'
const missingRefund = '更正：撤銷缺交扣分'

function transaction(reason = late, amount = -10, date = '2026-09-01T16:00:00Z') {
  return { reason, amount, date }
}

function fixture({ statuses = ['late'], transactions = [transaction()], rules = [] } = {}) {
  const classId = 'fixture-legacy-effects'
  const tasks = statuses.map((_, i) => ({ id: `fixture-task-${i}`, title: `假作業標題-${i}`, type: '作業' }))
  const status = Object.fromEntries(tasks.flatMap(({ id }, i) => statuses[i] === undefined ? [] : [[id, statuses[i]]]))
  return {
    classId,
    data: {
      classId,
      updatedAt: '2026-11-01',
      students: [{
        id: 'fixture-student', number: 17, name: '假學生姓名',
        bank: {
          balance: transactions.reduce((sum, row) => sum + row.amount, 0),
          transactions: transactions.map((row, i) => ({ id: `fixture-tx-${i}`, ...row })),
        },
      }],
      logs: [{ date: '2026-09-02', tasks, status: { 'fixture-student': status } }],
      settings: { automation: { latePenalty: -10, missingPenalty: -20 }, behaviorRules: rules },
    },
  }
}

function convertFixture(options) {
  return convert(fixture(options), { decisions })
}

it('只有明列且外鍵解析的扣分狀態產生歷史效果，共同欄位和候選一致', () => {
  const source = fixture({ statuses: ['late', true, false, 'leave', 'exempt', 'on_time', undefined, null] })
  source.data.logs[0].status['fixture-unresolved-student'] = { 'fixture-task-0': 'late' }
  source.data.logs[0].status['fixture-student']['fixture-orphan-task'] = 'on_time'
  const { rows } = convert(source, { decisions })
  const [submission] = rows.submissions
  expect(rows.legacy_effects).toEqual([{
    id: expect.any(String), batch_id: submission.batch_id, class_id: submission.class_id,
    legacy_id: null, source_path: submission.source_path,
    raw: { candidate_transactions: 1, refund_transactions: 0, possible_submissions: 1 },
    submission_id: submission.id, student_id: submission.student_id, task_id: submission.task_id,
    link_state: 'candidate', event: 'submission.late', transaction_id: rows.transactions[0].id,
    amount_at_link: -10, unresolved_reason: null,
  }])
})

it.each([
  ['has_makeup', { statuses: ['late', 'late', 'makeup'], transactions: [] }],
  ['multiple_submissions', { statuses: ['late', 'late'], transactions: [transaction(lateRefund, 10)] }],
  ['no_candidate', { transactions: [transaction(lateRefund, 10), transaction('作業遲交（假備註）')] }],
  ['multiple_candidates', { transactions: [transaction(), transaction(), transaction(lateRefund, 10)] }],
  ['has_refund', { transactions: [transaction(late, -9), transaction(lateRefund, 10)] }],
  ['amount_mismatch', { transactions: [transaction(late, -9, '假日期')] }],
  ['date_unknown', { transactions: [transaction(late, -10, '2026-02-30')], rules: [{ id: 'fixture-rule', label: late, amount: -10 }] }],
  ['date_before_task', { transactions: [transaction(late, -10, '2026-09-01T15:59:59Z')], rules: [{ id: 'fixture-rule', label: late, amount: -10 }] }],
  ['same_name_rule', { rules: [{ id: 'fixture-rule', label: late, amount: -10 }] }],
])('依條件順序記下第一個原因 %s', (reason, options) => {
  const out = convertFixture(options)
  expect(out.rows.legacy_effects?.[0]).toMatchObject({
    link_state: 'unresolved', unresolved_reason: reason, transaction_id: null, amount_at_link: null, event: null,
  })
})

it('補交跨兩種事件計算，遲交與缺交各自判定', () => {
  const transactions = [transaction(late), transaction(missing, -20)]
  const linked = convertFixture({ statuses: ['late', 'missing'], transactions })
  expect(linked.rows.legacy_effects?.map(row => row.event)).toEqual(['submission.late', 'submission.missing'])
  const makeup = convertFixture({ statuses: ['makeup'], transactions: [transactions[1]] })
  expect(makeup.rows.legacy_effects?.[0]).toMatchObject({ link_state: 'candidate', event: 'submission.missing' })
  const ambiguous = convertFixture({ statuses: ['makeup'], transactions })
  expect(ambiguous.rows.legacy_effects?.[0]?.unresolved_reason).toBe('multiple_candidates')
  const refunded = convertFixture({ statuses: ['makeup'], transactions: [transactions[0], transaction(missingRefund, 20)] })
  expect(refunded.rows.legacy_effects?.[0]?.unresolved_reason).toBe('has_refund')
})

it.each([{}, { orphanTaskStatus: 'snapshot_only' }])('孤兒扣分狀態優先且只影響同學生 %j', decision => {
  const source = fixture({ statuses: ['late', 'makeup'] })
  source.data.students.push({ id: 'fixture-other', bank: source.data.students[0].bank })
  source.data.logs[0].status['fixture-other'] = { 'fixture-task-0': 'late', 'fixture-other-orphan': true }
  source.data.logs.push({ date: '2026-09-03', status: { 'fixture-student': { 'fixture-orphan-task': 'missing' } } })
  const { rows } = convert(source, { decisions: { ...decisions, ...decision } })
  expect(rows.legacy_effects?.map(row => row.unresolved_reason)).toEqual(['orphan_status', 'orphan_status', null])
  expect(rows.legacy_effects[0].raw.possible_submissions).toBe(3)
})

it('其他天仍找得到作業時，當天無法解析的繳交也不算孤兒', () => {
  const source = fixture()
  source.data.logs[0].tasks.push({ id: 'fixture-other-day', title: '假跨日作業' })
  source.data.logs.push({ date: '2026-09-03', status: { 'fixture-student': { 'fixture-other-day': 'missing' } } })
  const { rows } = convert(source, { decisions })
  expect(rows.legacy_effects?.map(row => [row.link_state, row.raw.possible_submissions])).toEqual([['candidate', 2]])
})

it('根交易依更正鏈算有效金額，原始金額仍用來比較現行設定', () => {
  const original = { ...transaction(), voided: true }
  const correction = { ...transaction('假修正差額', 3), type: 'correction', correctedTxId: 'fixture-tx-0', voided: true }
  const next = { ...transaction('假再修正差額', -1), type: 'correction', correctedTxId: 'fixture-tx-1' }
  const changed = convertFixture({ transactions: [original, correction, next] })
  expect(changed.rows.legacy_effects?.[0]).toMatchObject({ link_state: 'candidate', amount_at_link: -8 })
  const undone = convertFixture({ transactions: [original, { ...correction, amount: 10 }] })
  expect(undone.rows.legacy_effects?.[0]?.unresolved_reason).toBe('no_candidate')
})

it('逐列報告保留座號、發布日、候選明細及各同名規則金額', () => {
  const out = convertFixture({
    statuses: ['late', 'missing'],
    transactions: [transaction(), transaction(missing, -20)],
    rules: [{ id: 'fixture-rule-1', label: late, amount: -11 }, { id: 'fixture-rule-2', label: late, amount: -12 }],
  })
  expect(out.report.legacy_effects).toEqual([0, 1].map(index => {
    const row = out.rows.legacy_effects?.[index]
    return {
      submission_id: row?.submission_id, link_state: 'candidate', unresolved_reason: null,
      seat_number: 17, task_title: `假作業標題-${index}`, task_published_on: '2026-09-02',
      same_name_rule_amounts: index === 0 ? { [late]: [-11, -12] } : { [missing]: '無' },
      candidate_transactions: [{
        transaction_id: row?.transaction_id, date: '2026-09-02', amount: index === 0 ? -10 : -20,
        reason: index === 0 ? late : missing,
      }],
    }
  }))
})

it('報告逐生列出有效舊扣分交易多於可能帶扣分繳交的學生', () => {
  const source = fixture({ statuses: ['on_time'], transactions: [transaction(), transaction(missing, -20)] })
  source.data.students.push({ id: 'fixture-other', number: 18, bank: { transactions: [] } })
  const out = convert(source, { decisions })
  expect(out.report.excess_legacy_deductions).toEqual([{
    student_id: out.rows.students[0].id, seat_number: 17, candidate_transactions: 2, possible_submissions: 0,
  }])
})

it('新輸出以新批次版本識別', () => {
  expect(convertFixture().rows.migration_batches[0].converter_version).toBe('v2-1A-r5')
})

it('沒有候選時仍可核對適用事件的同名規則金額', () => {
  const out = convertFixture({ statuses: ['makeup'], transactions: [], rules: [{ id: 'fixture-rule', label: late, amount: -11 }] })
  expect(out.report.legacy_effects[0]).toMatchObject({
    candidate_transactions: [], same_name_rule_amounts: { [late]: [-11], [missing]: '無' },
  })
})

function auditFixture(options, mutate) {
  const source = fixture(options)
  const converted = convert(source, { decisions })
  expect(reconcile(source, converted).differences).toEqual([])
  mutate(converted.rows)
  return reconcile(source, converted).differences.map(({ path }) => path)
}

it('對帳從來源辨認歷史效果，不依賴被一併刪除的繳交列', () => {
  const paths = auditFixture(undefined, rows => {
    rows.legacy_effects.pop()
    rows.submissions.pop()
  })
  expect(paths).toContain('legacy_effects/source_paths')
})

it('對帳拒絕重複的歷史效果列', () => {
  const paths = auditFixture(undefined, rows => rows.legacy_effects.push({ ...rows.legacy_effects[0] }))
  expect(paths).toContain('legacy_effects/source_paths')
})

it('對帳拒絕為不扣分、缺少狀態或參照失效的繳交新增歷史效果', () => {
  const source = fixture({ statuses: ['late', 'on_time', undefined] })
  source.data.logs[0].status['fixture-student']['fixture-orphan-task'] = 'late'
  source.data.logs[0].tasks.push({ id: 'fixture-task-3' }, { id: 'fixture-task-3' })
  source.data.logs[0].status['fixture-student']['fixture-task-3'] = 'missing'
  source.data.logs[0].status['fixture-orphan-student'] = { 'fixture-task-0': 'missing' }
  const converted = convert(source, { decisions })
  expect(reconcile(source, converted).differences).toEqual([])
  const [effect] = converted.rows.legacy_effects
  for (const submission of converted.rows.submissions.slice(1)) {
    const tampered = structuredClone(converted)
    tampered.rows.legacy_effects.push({
      ...effect, source_path: submission.source_path, submission_id: submission.id,
      task_id: submission.task_id, student_id: submission.student_id,
    })
    expect(reconcile(source, tampered).differences.map(({ path }) => path)).toContain('legacy_effects/source_paths')
  }
})

it('對帳拒絕兩列候選共用一筆交易', () => {
  const paths = auditFixture({
    statuses: ['late', 'missing'], transactions: [transaction(), transaction(missing, -20)],
  }, rows => {
    const [first, second] = rows.legacy_effects
    second.transaction_id = first.transaction_id
    second.amount_at_link = first.amount_at_link
  })
  expect(paths).toContain('legacy_effects/candidate_transaction_ids')
})

it('對帳檢查候選金額必須為負，即使與來源交易相等', () => {
  const paths = auditFixture({ transactions: [transaction(), transaction(late, 8)] }, rows => {
    const [effect] = rows.legacy_effects
    effect.transaction_id = rows.transactions[1].id
    effect.amount_at_link = 8
  })
  expect(paths).toContain('legacy_effects/data/logs/0/status/fixture-student/fixture-task-0/amount_at_link_negative')
})

it('對帳以來源更正差額檢查有效金額，交易與效果一起竄改也抓得到', () => {
  const paths = auditFixture({
    transactions: [transaction(), { ...transaction('假修正金額', 3), type: 'correction', correctedTxId: 'fixture-tx-0' }],
  }, rows => {
    rows.transactions[1].amount = 5
    rows.legacy_effects[0].amount_at_link = -5
  })
  expect(paths).toContain('legacy_effects/data/logs/0/status/fixture-student/fixture-task-0/amount_at_link')
})

it('對帳拒絕候選指向不存在的交易', () => {
  const paths = auditFixture(undefined, rows => {
    rows.legacy_effects[0].transaction_id = 'fixture-absent-transaction'
  })
  expect(paths).toContain('legacy_effects/data/logs/0/status/fixture-student/fixture-task-0/amount_at_link')
})

it('對帳拒絕保留路徑卻改指另一筆繳交的效果列', () => {
  const paths = auditFixture({ statuses: ['late', 'on_time'] }, rows => {
    rows.legacy_effects[0].submission_id = rows.submissions[1].id
  })
  expect(paths).toContain('legacy_effects/data/logs/0/status/fixture-student/fixture-task-0/submission_id')
})
