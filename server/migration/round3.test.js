import { describe, expect, it } from 'vitest'
import { convert } from './convert.js'
import { reconcile, legacyEarned } from './reconcile.js'
import { validateSource } from './source-validation.js'

const decisions = { cutoverDate: '2026-11-15', openingAdjustment: true, semesterRule: 'month' }

function sourceWith(transactions = [], bank = {}) {
  return {
    classId: 'round3',
    data: {
      classId: 'round3',
      updatedAt: '2026-07-15',
      settings: {},
      students: [{ id: 's1', bank: { balance: 0, totalEarned: 0, transactions, ...bank } }],
    },
  }
}

describe('7.4 A 轉換決定', () => {
  it('批次保存決定，對帳使用批次決定並檢查呼叫端給的預期決定', () => {
    const source = sourceWith()
    const selected = { cutoverDate: decisions.cutoverDate, semesterRule: 'month' }
    const output = convert(source, { decisions: selected })
    const batch = output.rows.migration_batches[0]
    expect(batch).toMatchObject({ decisions: selected, cutover_date: '2026-11-15', converter_version: 'v2-1A-r3' })
    expect(batch).not.toHaveProperty('semester_basis')
    expect(output.rows.classes[0].current_semester).toBe('115-1')
    expect(reconcile(source, output).differences).toEqual([])
    expect(reconcile(source, output, { decisions: {} }).differences).toContainEqual({
      path: 'migration_batches/decisions', expected: {}, actual: selected,
    })
    const fallback = convert(source)
    expect(fallback.rows.classes[0].current_semester).toBe('114-2')
    expect(fallback.rows.migration_batches[0]).toMatchObject({ decisions: {}, cutover_date: null })
    expect(fallback.rows.migration_batches[0].id).not.toBe(batch.id)
    expect(convert(source, { decisions: { cutoverDate: selected.cutoverDate } }).rows.migration_batches[0].id).not.toBe(batch.id)
    expect(convert(source, { decisions: { semesterRule: 'month', cutoverDate: selected.cutoverDate } })).toEqual(output)
  })

  it('期初調整缺切換日會直接拒絕', () => {
    const options = { decisions: { openingAdjustment: true } }
    expect(() => convert(sourceWith(), options)).toThrow(/cutoverDate/)
    expect(() => validateSource(sourceWith(), legacyEarned, options)).toThrow(/cutoverDate/)
  })

  it('未傳月份規則時有日期也留空並回報未知學期', () => {
    const source = sourceWith([{ id: 'tx', amount: 0, date: '2026-07-15' }])
    source.data.logs = [{ date: '2026-11-15', tasks: [{ id: 'task' }] }]
    const output = convert(source)
    expect(output.rows.transactions[0].semester).toBeNull()
    expect(output.rows.tasks[0].semester).toBeNull()
    expect(output.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'UNKNOWN_TRANSACTION_SEMESTER', 'UNKNOWN_TASK_SEMESTER',
    ]))
  })
})
