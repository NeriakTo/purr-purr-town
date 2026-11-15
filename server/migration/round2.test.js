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
  it('A1 缺編號列不匹配空座位或字串 null 作業', () => {
    const source = sourceWith([{ name: '測試甲' }])
    source.data.settings.seatingChart = { grid: { '0-0': null } }
    source.data.logs = [{ date: '2026-11-15', tasks: [{}], status: { s1: { null: true } } }]
    assertAligned(source)
  })
})
