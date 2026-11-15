import { describe, it, expect } from 'vitest'
import { convert, canonicalJson, digest } from './convert.js'
import { reconcile, legacyEarned } from './reconcile.js'
import { validateSource, orderedErrors } from './source-validation.js'

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
