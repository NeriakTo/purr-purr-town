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

describe('7.4 B–D 舊交易欄位', () => {
  it('根交易、更正前一筆與更正歸屬日各自保留，商店更正不計累計', () => {
    const source = sourceWith([
      { id: 'root', amount: 100, date: '2026-07-20', voided: true },
      { id: 'fix', type: 'correction', correctedTxId: 'root', amount: -20, date: '2026-08-20', voided: true },
      { id: 'tail', type: 'correction', correctedTxId: 'fix', amount: 5, date: '2026-09-10' },
      { id: 'buy', amount: -30, reason: '購買：假卡', date: '2026-09-10', excludeFromTotal: false },
      { id: 'buy-fix', type: 'correction', correctedTxId: 'buy', amount: 10, date: '2026-10-15' },
      { id: 'buy-tail', type: 'correction', correctedTxId: 'buy-fix', amount: 2, date: '2026-10-15' },
      { id: 'use', amount: 0, reason: '使用道具：假卡', date: '2026-10-15' },
    ])
    const output = convert(source, { decisions: { semesterRule: 'month' } })
    const [root, fix, tail, buy, buyFix, buyTail, use] = output.rows.transactions
    expect(root).toMatchObject({ kind: 'legacy_general', root_transaction_id: null, earned_delta: 100, voided: true })
    expect(fix).toMatchObject({ kind: 'correction', root_transaction_id: root.id, corrected_transaction_id: root.id, earned_delta: -20 })
    expect(tail).toMatchObject({
      kind: 'correction', root_transaction_id: root.id, corrected_transaction_id: fix.id,
      earned_delta: 5, effective_at: '2026-07-20', semester: '114-2', occurred_at: '2026-09-10', transaction_type: 'correction',
    })
    expect(buy).toMatchObject({ kind: 'shop_purchase', earned_delta: 0, raw: { excludeFromTotal: false } })
    expect(buyFix).toMatchObject({ kind: 'correction', root_transaction_id: buy.id, earned_delta: 0 })
    expect(buyTail).toMatchObject({ kind: 'correction', root_transaction_id: buy.id, earned_delta: 0 })
    expect(use).toMatchObject({ kind: 'item_use', earned_delta: 0 })
    for (const row of output.rows.transactions) {
      expect(row).toMatchObject({ chain_broken: false, origin: 'migration', op_id: null })
      expect(row).not.toHaveProperty('exclude_from_total')
    }
    expect(reconcile(source, output).differences).toEqual([])
  })

  it('孤立、更正循環與經過斷鏈的後代各自計算', () => {
    const source = sourceWith([
      { id: 'orphan', type: 'correction', correctedTxId: 'absent', amount: 11, reason: '撤銷：修正：撤銷：購買：假卡' },
      { id: 'descendant', type: 'correction', correctedTxId: 'orphan', amount: 3, reason: '修正：加分' },
      { id: 'loop', type: 'correction', correctedTxId: 'loop', amount: 7, reason: '修正：使用道具：假卡' },
      { id: 'loop-tail', type: 'correction', correctedTxId: 'loop', amount: 1 },
      { id: 'dup', amount: 0 },
      { id: 'dup', amount: 0 },
      { id: 'ambiguous', type: 'correction', correctedTxId: 'dup', amount: 4 },
    ].map(transaction => ({ date: '2026-09-01', ...transaction })))
    const output = convert(source)
    const [orphan, descendant, loop, loopTail, , , ambiguous] = output.rows.transactions
    for (const row of [orphan, descendant, loop, loopTail, ambiguous]) {
      expect(row).toMatchObject({
        kind: 'legacy_orphan_correction', chain_broken: true, root_transaction_id: null,
        effective_at: row.occurred_at, origin: 'migration', op_id: null, semester: null,
      })
    }
    expect([orphan, descendant, loop, loopTail, ambiguous].map(row => row.earned_delta)).toEqual([0, 3, 0, 1, 4])
    expect(descendant.corrected_transaction_id).toBe(orphan.id)
    expect(loop.corrected_transaction_id).toBeNull()
    expect(ambiguous.corrected_transaction_id).toBeNull()
    expect(output.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'ORPHAN_CORRECTION', 'CORRECTION_CYCLE', 'AMBIGUOUS_REFERENCE',
    ]))
    expect(reconcile(source, output).differences).toEqual([])
  })

  it.each([{}, { semesterRule: 'month' }])('日期與金額錯誤各自阻擋，無法填有效欄位 %j', selected => {
    const source = sourceWith([{ id: 'bad', amount: '20', date: '2026-02-30' }])
    const output = convert(source, { decisions: selected })
    expect(output.rows.transactions[0]).toMatchObject({
      effective_at: null, occurred_at: '2026-02-30', amount: null, earned_delta: null, semester: null,
    })
    expect(output.errors.map(error => error.code)).toEqual(expect.arrayContaining(['INVALID_TRANSACTION_DATE', 'INVALID_AMOUNT']))
    expect(reconcile(source, output).ready_for_import).toBe(false)
  })
})
