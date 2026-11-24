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
    expect(batch).toMatchObject({ decisions: selected, cutover_date: '2026-11-15', converter_version: 'v2-1A-r4' })
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

describe('7.4 E–F 期初調整與帳戶', () => {
  it('餘額已平時仍補新累計差額，調整列遵循期初契約', () => {
    const source = sourceWith([
      { id: 'root', amount: 100, date: '2026-07-20', voided: true },
      { id: 'fix', type: 'correction', correctedTxId: 'root', amount: -20, date: '2026-08-20' },
      { id: 'buy', amount: -30, reason: '購買：假卡', date: '2026-09-10' },
    ], { balance: 50, totalEarned: 85 })
    const converted = convert(source, { decisions })
    expect(converted.rows.accounts[0]).toMatchObject({
      balance: 50, total_earned: 85, total_earned_source: 'legacy_stored', ledger_sum: 50,
      legacy_earned_recomputed: -20, earned_delta_sum: 80,
    })
    expect(converted.rows.accounts[0]).not.toHaveProperty('earned_recomputed')
    const [adjustment] = converted.rows.transactions.filter(row => row.kind === 'migration_opening_adjustment')
    expect(adjustment).toMatchObject({
      source_path: '/data/students/0/bank', kind: 'migration_opening_adjustment',
      amount: 0, earned_delta: 5, occurred_at: '2026-11-15T00:00:00+08:00',
      reason: '轉換期初調整', transaction_type: 'opening_adjustment',
      effective_at: null, semester: null, root_transaction_id: null, corrected_transaction_id: null,
      balance_after: null, legacy_id: null, voided: false, chain_broken: false, legacy_semantics: true,
      origin: 'migration', op_id: null,
      raw: { balance: 50, ledger_sum: 50, total_earned: 85, earned_delta_sum: 80 },
    })
    expect(converted.report.opening_adjustments).toEqual([
      { path: '/data/students/0/bank', amount: 0, earned_delta: 5, reason: '轉換期初調整' },
    ])
    expect(converted.report.notices).toContainEqual({
      code: 'TOTAL_EARNED_DRIFT', path: '/data/students/0/bank', value: { stored: 85, computed: -20 },
    })
    expect(reconcile(source, converted).differences).toEqual([])
    expect(reconcile(source, converted).ready_for_import).toBe(true)
  })

  it('兩個差額為零時不補交易，切換日單獨提供時也不補交易', () => {
    const source = sourceWith([{ id: 'tx', amount: 5, date: '2026-11-15', voided: true }], { balance: 5, totalEarned: 5 })
    const unchanged = convert(source, { decisions })
    expect(unchanged.rows.transactions).toHaveLength(1)
    expect(unchanged.report.opening_adjustments).toEqual([])
    expect(unchanged.report.notices.map(error => error.code)).toEqual(['TOTAL_EARNED_DRIFT'])

    source.data.students[0].bank.balance = 30
    const selected = { cutoverDate: decisions.cutoverDate, semesterRule: 'month' }
    const withoutAdjustment = convert(source, { decisions: selected })
    expect(withoutAdjustment.rows.transactions).toHaveLength(1)
    expect(withoutAdjustment.errors.map(error => error.code)).toEqual(['BALANCE_DRIFT', 'TOTAL_EARNED_DRIFT'])
  })
})

describe('7.4 G 作業與來源檢查', () => {
  it('歷史作業名單維持未知並列路徑提示，單靠此提示不阻擋匯入', () => {
    const source = sourceWith()
    source.data.logs = [{ date: '2026-11-20', tasks: [{ id: 'task' }] }]
    const output = convert(source, { decisions })
    expect(output.errors).toEqual([])
    expect(output.rows.tasks[0]).toMatchObject({ semester: '115-1', assignees_known: false })
    expect(output.report.notices).toEqual([
      { code: 'UNKNOWN_ASSIGNMENT_LIST', path: '/data/logs/0/tasks/0', value: null },
    ])
    expect(reconcile(source, output).ready_for_import).toBe(true)
    output.report.notices = []
    expect(reconcile(source, output).differences.map(item => item.path)).toContain('report/notices')
  })

  it('指定月份規則仍擋非法發布日期，已填但格式錯誤的目前學期也擋匯入', () => {
    const source = sourceWith()
    source.data.settings.currentSemester = false
    source.data.logs = [{ date: '2026-02-30', tasks: [{ id: 'task' }] }]
    const output = convert(source, { decisions })
    expect(output.rows.classes[0].current_semester).toBeNull()
    expect(output.rows.tasks[0].semester).toBeNull()
    expect(output.errors.map(error => error.code)).toEqual(['INVALID_CURRENT_SEMESTER', 'INVALID_TASK_DATE'])
    expect(reconcile(source, output).ready_for_import).toBe(false)
  })
})

function auditSource() {
  const source = sourceWith([
    { id: 'root', amount: 100, date: '2026-07-31T15:59:59Z', voided: true },
    { id: 'fix', type: 'correction', correctedTxId: 'root', amount: -20, date: '2026-08-01' },
    { id: 'buy', amount: -30, reason: '購買：假卡', date: '2026-07-31', voided: true },
    { id: 'buy-fix', type: 'correction', correctedTxId: 'buy', amount: 10, date: '2026-08-15' },
  ], { balance: 64, totalEarned: 90 })
  source.data.settings.semesterPeriods = {
    midterm: { start: '2026-07-01', end: '2026-07-31' },
    final: { start: '2026-08-01', end: '2026-12-31' },
    all: { start: null, end: null },
  }
  return source
}

const studentPath = '/data/students/0'
const rootPath = studentPath + '/bank/transactions/0'
const correctionPath = studentPath + '/bank/transactions/1'

function verifyAuditTampering(path, mutate) {
  const source = auditSource()
  const converted = convert(source, { decisions })
  const audit = reconcile(source, converted)
  expect(audit.differences).toEqual([])
  expect(audit.ready_for_import).toBe(true)
  mutate(converted.rows)
  const tampered = reconcile(source, converted)
  expect(tampered.differences.map(item => item.path)).toContain(path)
  expect(tampered.ready_for_import).toBe(false)
}

describe('7.4 G 對帳七項檢查', () => {
  it('1 交易金額合計必須等於輸出的帳戶餘額', () => {
    verifyAuditTampering(studentPath + '/amount_sum_vs_balance', rows => { rows.accounts[0].balance = 60 })
  })

  it('2 累計增減合計必須等於輸出的帳戶累計', () => {
    verifyAuditTampering(studentPath + '/earned_delta_sum_vs_total', rows => { rows.accounts[0].total_earned = 80 })
  })

  it('1、2 未選期初調整時由來源錯誤回報差額，各自略過等式檢查', () => {
    const source = auditSource()
    const converted = convert(source, { decisions: { semesterRule: 'month' } })
    const audit = reconcile(source, converted)
    expect(audit.source_errors.map(error => error.code)).toEqual(['BALANCE_DRIFT', 'TOTAL_EARNED_DRIFT'])
    expect(audit.differences).toEqual([])
  })

  it.each(['missing', 'other-root', 'unreachable', 'non-root'])('3 更正根非空、有根種類且前一筆關係可達 %s', mutation => {
    verifyAuditTampering(correctionPath + '/correction_root', rows => {
      const correction = rows.transactions[1]
      if (mutation === 'missing') correction.root_transaction_id = null
      if (mutation === 'other-root') correction.root_transaction_id = rows.transactions[2].id
      if (mutation === 'unreachable') correction.corrected_transaction_id = null
      if (mutation === 'non-root') rows.transactions[0].kind = 'legacy_orphan_correction'
    })
  })

  it('3 空的根編號與前一筆外鍵都無法指向根', () => {
    verifyAuditTampering(correctionPath + '/correction_root', rows => {
      rows.transactions[0].id = null
      rows.transactions[1].corrected_transaction_id = null
      rows.transactions[1].root_transaction_id = null
    })
  })

  it.each(['effective_at', 'semester'])('4 更正的 %s 必須跟根交易相同', key => {
    verifyAuditTampering(correctionPath + '/root_' + key, rows => { rows.transactions[1][key] = null })
  })

  it.each([true, false])('5 斷鏈旗標與孤立種類雙向一致 %s', broken => {
    verifyAuditTampering(rootPath + '/chain_broken_kind', rows => {
      const root = rows.transactions[0]
      if (broken) root.chain_broken = true
      else root.kind = 'legacy_orphan_correction'
    })
  })

  it('6 每人最多一筆期初調整', () => {
    verifyAuditTampering(studentPath + '/opening_adjustment_count', rows => {
      rows.transactions.push(structuredClone(rows.transactions.at(-1)))
    })
  })

  it('6 期初調整沒有期間歸屬日', () => {
    verifyAuditTampering(studentPath + '/bank/opening_adjustment_effective_at', rows => {
      rows.transactions.at(-1).effective_at = '2026-11-15'
    })
  })

  it('4 日期異常的更正仍擋匯入，空歸屬日和有效根日期列出差異', () => {
    const source = auditSource()
    source.data.students[0].bank.transactions[1].date = 'bad'
    const converted = convert(source, { decisions })
    expect(converted.errors.map(error => error.code)).toContain('INVALID_TRANSACTION_DATE')
    expect(converted.rows.transactions[1].effective_at).toBeNull()
    expect(reconcile(source, converted).differences).toContainEqual({
      path: correctionPath + '/root_effective_at', expected: '2026-07-31T15:59:59Z', actual: null,
    })
  })

  it('7 並列舊、新期間統計與逐生差額，改歸屬日會抓到新統計差異', () => {
    const source = auditSource()
    source.data.students.push({
      id: 's2', bank: { balance: 7, totalEarned: 7, transactions: [{ id: 'other', amount: 7, date: '2026-07-07' }] },
    })
    const converted = convert(source, { decisions })
    const audit = reconcile(source, converted)
    expect(audit.differences).toEqual([])
    expect(audit.students[1].period_comparison.midterm).toEqual({ legacy: 7, current: 7, difference: 0 })
    expect(audit.students[0].period_comparison).toEqual({
      midterm: { legacy: 0, current: 80, difference: 80 },
      final: { legacy: -10, current: 0, difference: 10 },
      all: { legacy: -20, current: 80, difference: 100 },
    })
    converted.rows.transactions[1].effective_at = '2026-08-01'
    expect(reconcile(source, converted).differences).toContainEqual({
      path: studentPath + '/new_period/midterm', expected: 80, actual: 100,
    })
  })
})

describe('7.4 I 匯入繳交版本', () => {
  it('檢查匯入列的版本與指派狀態，舊版缺鍵的待收列也逐筆核對', () => {
    const source = sourceWith()
    source.data.logs = [{
      date: '2026-11-20', tasks: [{ id: 'present' }, { id: 'pending' }], status: { s1: { present: true } },
    }]
    const converted = convert(source, { decisions })
    expect(converted.rows.submissions.map(row => row.present)).toEqual([true, false])
    for (const row of converted.rows.submissions) expect(row).not.toHaveProperty('rev')
    expect(reconcile(source, converted).differences).toEqual([])

    const imported = converted.rows.submissions.map(row => ({
      ...row, rev: 1, basis_rev: 1, assignment_active: true,
    }))
    expect(reconcile(source, converted, { importedSubmissions: imported }).differences).toEqual([])
    for (const [key, value] of Object.entries({ rev: 2, basis_rev: 0, assignment_active: false })) {
      const tampered = structuredClone(imported)
      tampered[1][key] = value
      expect(reconcile(source, converted, { importedSubmissions: tampered }).differences.map(item => item.path))
        .toContain('imported_submissions' + tampered[1].source_path + '/' + key)
    }
    expect(reconcile(source, converted, { importedSubmissions: imported.slice(0, 1) }).differences.map(item => item.path))
      .toContain('imported_submissions/source_paths')
  })
})

it('7.4 A 乾淨的試轉也須明傳三項決定才能標記可匯入', () => {
  const source = sourceWith()
  for (const selected of [{}, { cutoverDate: decisions.cutoverDate, semesterRule: 'month' }, decisions]) {
    const converted = convert(source, { decisions: selected })
    const audit = reconcile(source, converted)
    expect(converted.errors).toEqual([])
    expect(audit.differences).toEqual([])
    const expected = selected === decisions
    expect(converted.report.ready_for_import).toBe(expected)
    expect(audit.ready_for_import).toBe(expected)
  }
})
