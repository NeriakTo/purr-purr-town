import { describe, it, expect } from 'vitest'
import { convert, canonicalJson, digest, semesterAt } from './convert.js'
import { reconcile, legacyEarned } from './reconcile.js'
import { validateSource, orderedErrors } from './source-validation.js'
import { calcEarnedFromTransactions, getCurrentSemester } from '../../src/utils/helpers.js'

function sourceWith(students = []) {
  return { classId: 'round2', data: { classId: 'round2', updatedAt: '2026-11-15', students, logs: [], settings: {} } }
}
function student(transactions = [], extra = {}) {
  return { id: 's1', name: '測試甲', bank: { balance: 0, totalEarned: 0, transactions }, ...extra }
}
function assertAligned(source) {
  const converted = convert(source)
  const result = reconcile(source, converted)
  expect(orderedErrors(result.source_errors)).toEqual(orderedErrors(converted.errors))
  expect(result.differences).toEqual([])
  expect(result.ready_for_import).toBe(false)
}
describe('第二輪正式轉換', () => {
  it('B7 已設定學期但調整缺基準日仍擋匯入', () => {
    const source = sourceWith([student()])
    source.data.settings.currentSemester = '115-1'
    source.data.students[0].bank.balance = 3
    delete source.data.updatedAt
    const converted = convert(source)
    expect(converted.errors).toContainEqual({ code: 'UNKNOWN_TRANSACTION_SEMESTER', path: '/data/students/0/bank/migration_opening_adjustment', value: null })
    assertAligned(source)
  })
  it('B7 明傳切換日決定空學期與調整日期並記錄批次', () => {
    const source = sourceWith([student()])
    source.data.students[0].bank.balance = 3
    const options = { cutoverDate: '2027-02-01' }
    const converted = convert(source, options)
    expect(converted.rows.classes[0].current_semester).toBe('115-2')
    expect(converted.rows.migration_batches[0]).toMatchObject({ semester_basis: 'cutover_date', cutover_date: options.cutoverDate })
    expect(converted.rows.transactions[0]).toMatchObject({ occurred_at: options.cutoverDate, semester: '115-2' })
    expect(reconcile(source, converted, options).differences).toEqual([])
    expect(reconcile(source, converted, options).ready_for_import).toBe(true)
    expect(convert(source, options)).toEqual(converted)
    expect(convert(source).rows.migration_batches[0]).toMatchObject({ semester_basis: 'updated_at', cutover_date: null })
    expect(convert(source).rows.migration_batches[0].id).not.toBe(converted.rows.migration_batches[0].id)
    expect(reconcile(source, converted).matches).toBe(false)
  })
  it('B7 已指定學期優先，切換日仍控制調整日期', () => {
    const source = sourceWith([student()])
    source.data.settings.currentSemester = '114-1'
    source.data.students[0].bank.balance = 3
    const options = { cutoverDate: '2027-02-01' }
    const converted = convert(source, options)
    expect(converted.rows.classes[0].current_semester).toBe('114-1')
    expect(converted.rows.migration_batches[0].semester_basis).toBe('declared')
    expect(converted.rows.transactions[0].occurred_at).toBe(options.cutoverDate)
    expect(reconcile(source, converted, options).differences).toEqual([])
  })
  it('B7 非法切換日明列錯誤，不退回匯出日', () => {
    const source = sourceWith([student()])
    source.data.students[0].bank.balance = 3
    const options = { cutoverDate: 'bad' }
    const converted = convert(source, options)
    expect(converted.rows.classes[0].current_semester).toBeNull()
    expect(converted.errors.map(e => e.code)).toContain('INVALID_CUTOVER_DATE')
    const result = reconcile(source, converted, options)
    expect(result.differences).toEqual([])
    expect(result.ready_for_import).toBe(false)
  })
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('B6 第 %i 月與舊 helper 一致，交易與作業各用本身日期', month => {
    const date = `2026-${String(month).padStart(2, '0')}-15`
    const semester = getCurrentSemester(new Date(2026, month - 1, 15, 12))
    const source = sourceWith([student([{ id: 't', amount: 0, date }])])
    source.data.logs = [{ date, tasks: [{ id: 'fallback' }, { id: 'own', createdAt: '2025-08-15' }] }]
    const converted = convert(source)
    expect(semesterAt(date)).toBe(semester)
    expect(converted.rows.transactions[0].semester).toBe(semester)
    expect(converted.rows.tasks.map(t => t.semester)).toEqual([semester, '114-1'])
    expect(converted.errors.map(e => e.code)).toEqual(['UNKNOWN_ASSIGNMENT_LIST', 'UNKNOWN_ASSIGNMENT_LIST'])
    expect(reconcile(source, converted).differences).toEqual([])
  })
  it.each([undefined, '', 'bad', '2026-02-30'])('B6 缺漏或非法日期 %s 仍擋匯入', date => {
    expect(semesterAt(date)).toBeNull()
    const source = sourceWith([student([{ id: 't', amount: 0, date }])])
    source.data.logs = [{ date, tasks: [{ id: 'task' }] }]
    const converted = convert(source)
    expect(converted.rows.transactions[0].semester).toBeNull()
    expect(converted.rows.tasks[0].semester).toBeNull()
    expect(converted.errors.map(e => e.code)).toEqual(expect.arrayContaining(['UNKNOWN_TRANSACTION_SEMESTER', 'UNKNOWN_TASK_SEMESTER', 'UNKNOWN_ASSIGNMENT_LIST']))
    assertAligned(source)
  })
  it('B6 臺灣跨日邊界與無時區時間有固定結果', () => {
    expect(semesterAt('2026-07-31T16:00:00Z')).toBe('115-1')
    expect(semesterAt('2026-08-01T00:00:00')).toBe('115-1')
  })
  it('B5 保存點數並產生確定性的期初調整，提示不擋匯入', () => {
    const source = sourceWith([student([{ id: 't', amount: 5, balance: 8 }])])
    source.data.students[0].bank.balance = 20
    source.data.students[0].bank.totalEarned = 50
    const converted = convert(source)
    expect(converted.errors.map(e => e.code)).not.toContain('BALANCE_DRIFT')
    expect(converted.report.notices.map(e => e.code)).toEqual(expect.arrayContaining(['BALANCE_DRIFT', 'TOTAL_EARNED_DRIFT', 'TRANSACTION_BALANCE_DRIFT']))
    expect(converted.rows.accounts[0]).toMatchObject({ balance: 20, total_earned: 50, ledger_sum: 5, earned_recomputed: 5 })
    const adjustment = converted.rows.transactions.find(t => t.transaction_type === 'migration_opening_adjustment')
    expect(adjustment).toMatchObject({ amount: 15, reason: '轉換期初調整', occurred_at: '2026-11-15', exclude_from_total: true, legacy_semantics: false })
    expect(legacyEarned(converted.rows.transactions.map(t => ({ id: t.id, type: t.transaction_type, amount: t.amount })))).toBe(calcEarnedFromTransactions(source.data.students[0].bank.transactions))
    expect(reconcile(source, converted).differences).toEqual([])
    expect(convert(source)).toEqual(converted)
  })
  it.each(['missing', 'extra', 'amount'])('B5 獨立驗證抓出期初調整 %s', mutation => {
    const source = sourceWith([student()])
    source.data.students[0].bank.balance = -7
    const converted = convert(source)
    const adjustment = converted.rows.transactions.find(t => t.transaction_type === 'migration_opening_adjustment')
    expect(adjustment?.amount).toBe(-7)
    if (mutation === 'missing') converted.rows.transactions.pop()
    if (mutation === 'extra') converted.rows.transactions.push(structuredClone(adjustment))
    if (mutation === 'amount') adjustment.amount = 1
    expect(reconcile(source, converted).matches).toBe(false)
  })
  it.each(['balance', 'totalEarned', 'amount'])('B5 非法金額 %s 仍擋匯入', field => {
    const source = sourceWith([student([{ id: 't', amount: 1 }])])
    if (field === 'amount') source.data.students[0].bank.transactions[0].amount = '1'
    else source.data.students[0].bank[field] = '1'
    assertAligned(source)
    expect(convert(source).errors.some(e => e.code.startsWith('INVALID_'))).toBe(true)
  })
  it.each([
    [
      { id: 'dup', amount: -30, reason: '購買：貼紙', voided: true },
      { id: 'dup', amount: -40, reason: '購買：筆', voided: true },
      { id: 'fix', type: 'correction', amount: 10, correctedTxId: 'dup' },
    ],
    [
      { id: 'a', amount: -20, reason: '購買：貼紙', voided: true, correctedTxId: 'b' },
      { id: 'b', type: 'correction', amount: 20, correctedTxId: 'a' },
    ],
  ])('A4 無法解析更正關聯時只跳過受影響學生期間 %#', (...transactions) => {
    const dated = transactions.map(t => ({ ...t, date: '2026-09-10' }))
    const source = sourceWith([student(dated), student([{ id: 'ok', amount: 5, date: '2026-09-10' }], { id: 's2' })])
    source.data.settings.semesterPeriods = { midterm: { start: '2026-09-01', end: '2026-10-31' } }
    const converted = convert(source)
    const result = reconcile(source, converted)
    expect(result.differences).toEqual([])
    expect(result.period_skipped).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/data/students/0', reason: expect.any(String) })]))
    expect(result.period_skipped.every(item => item.path === '/data/students/0')).toBe(true)
    converted.rows.transactions.find(t => t.raw?.id === 'ok').amount = 6
    expect(reconcile(source, converted).differences).toContainEqual({ path: '/data/students/1/period/midterm', expected: 5, actual: 6 })
  })
  it('A3 undefined 來源有固定雜湊與一致錯誤', () => {
    expect(canonicalJson(undefined)).toBe(canonicalJson(null))
    expect(digest(undefined)).toBe(digest(null))
    expect(orderedErrors(validateSource(undefined, legacyEarned))).toEqual(orderedErrors(convert(undefined).errors))
    assertAligned(undefined)
  })
  it.each([null, 123])('A2 非物件學生 %s 不使三支工具中止', value => {
    assertAligned(sourceWith([value]))
  })
  it('A2 非物件交易背包紀錄作業商品不使三支工具中止', () => {
    const source = sourceWith([student([null], { inventory: [null] })])
    source.data.logs = [null, { tasks: [null] }]
    source.data.settings.shop = { products: [null] }
    source.data.settings.jobs = [null]
    assertAligned(source)
  })
  it('A1 缺編號列不匹配空座位或字串 null 作業', () => {
    const source = sourceWith([{ name: '測試甲' }])
    source.data.settings.seatingChart = { grid: { '0-0': null } }
    source.data.logs = [{ date: '2026-11-15', tasks: [{}], status: { s1: { null: true } } }]
    assertAligned(source)
  })
})
