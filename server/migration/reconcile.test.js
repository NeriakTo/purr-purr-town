import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { convert, semesterAt } from './convert.js'
import { legacyEarned, reconcile } from './reconcile.js'
import { classA } from './__fixtures__/classes.js'
import { calcEarnedFromTransactions, ensureStudentBank } from '../../src/utils/helpers.js'

describe('舊版規則的獨立對照與失敗隔離', () => {
  it('統計與實際舊 helper 相同；excludeFromTotal 是 createTransaction 的參數，非歷史重算篩選旗標', () => {
    const txs = [
      { id: 'buy', amount: -30, reason: '購買 假卡', date: '2026-08-31T00:00:00Z', voided: true },
      { id: 'fix', amount: 10, reason: '改價', date: '2026-09-01T00:00:00Z', type: 'correction', correctedTxId: 'buy' },
      { id: 'award', amount: 100, reason: '獎勵', date: '2026-09-02T00:00:00Z', excludeFromTotal: true },
      { id: 'use', amount: 0, reason: '使用道具: 假卡', date: '2026-09-02T00:00:00Z' },
    ]
    for (const bounds of [{}, { startDate: '2026-09-01', endDate: '2026-09-30' }]) expect(legacyEarned(txs, bounds)).toBe(calcEarnedFromTransactions(txs, bounds))
    expect(legacyEarned(txs)).toBe(100)
    // 原購買不在區間內時，舊 helper 查不到原交易，差額會被計入。
    expect(legacyEarned(txs, { startDate: '2026-09-01' })).toBe(110)
  })
  it('有快取不覆寫、無快取才照 ensureStudentBank 重算', () => {
    const source = structuredClone(classA)
    delete source.data.students[0].bank.totalEarned
    const out = convert(source)
    expect(out.rows.accounts[0].total_earned).toBe(ensureStudentBank(source.data.students[0]).bank.totalEarned)
    expect(reconcile(source, out).differences).toEqual([])
  })
  it.each([
    ['2026-01-01', '114-1'], ['2026-02-01', '114-2'], ['2026-07-31', '114-2'], ['2026-08-01', '115-1'], ['2026-07-31T16:01:00Z', '115-1'], ['壞日期', null],
  ])('以臺灣日期推算 %s → %s', (date, sem) => expect(semesterAt(date)).toBe(sem))
  it('無匯出時間不依執行日猜學期；已保存評語不受影響', () => {
    const source = structuredClone(classA)
    delete source.data.updatedAt
    const out = convert(source)
    expect(out.rows.classes[0].current_semester).toBeNull()
    expect(out.errors.some(e => e.code === 'UNKNOWN_CURRENT_SEMESTER')).toBe(true)
    expect(out.rows.comments[0].semester).toBe('114-2')
  })
  it('空狀態容器不從現在名單創造應交紀錄', () => {
    const source = structuredClone(classA)
    source.data.logs[0].status = {}
    expect(convert(source).rows.submissions).toEqual([])
  })
  it('數字與字串 ID 的重複不會猜關聯', () => {
    const source = structuredClone(classA)
    source.data.students[0].id = 1
    source.data.students[1].id = '1'
    source.data.logs[0].status = { 1: { q0: true } }
    const out = convert(source)
    expect(out.rows.submissions.every(s => s.student_id === null)).toBe(true)
    expect(out.errors.some(e => e.code === 'AMBIGUOUS_REFERENCE')).toBe(true)
  })
  it('非法紀錄保全在來源與錯誤，不當成合法金額零', () => {
    const source = structuredClone(classA)
    source.data.students[0].bank.transactions[0].amount = '100'
    const out = convert(source)
    expect(out.rows.accounts[0].ledger_sum).toBeNull()
    expect(out.rows.transactions[0].amount).toBeNull()
    expect(out.rows.transactions[0].raw.amount).toBe('100')
    expect(out.report.ready_for_import).toBe(false)
    expect(reconcile(source, out).differences).toEqual([])
  })
  it('不合法 JSON 結構不讓轉換器拋出未處理例外', () => {
    const source = structuredClone(classA)
    source.data.students.push(null)
    source.data.logs.push(null)
    source.data.students[0].comments.bad = null
    const out = convert(source)
    expect(out.rows.migration_sources[0].raw).toEqual(source)
    expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(['INVALID_RECORD', 'INVALID_OBJECT', 'UNKNOWN_COMMENT_SEMESTER']))
    expect(() => convert(undefined)).not.toThrow()
  })
  it('餘額與交易前綴不一致只報差異，不發調整交易', () => {
    const source = structuredClone(classA)
    source.data.students[0].bank.balance = 999
    source.data.students[0].bank.transactions[0].balance = 101
    const out = convert(source)
    expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(['BALANCE_DRIFT', 'TRANSACTION_BALANCE_DRIFT']))
    expect(out.rows.accounts[0].balance).toBe(999)
    expect(out.rows.transactions).toHaveLength(6)
    expect(reconcile(source, out).ready_for_import).toBe(false)
  })
  it('DDL 欄位與輸出吻合，含實際會重複 source_path 的舊編號對照', () => {
    const sql = readFileSync(new URL('./schema-v2.sql', import.meta.url), 'utf8')
    const out = convert(classA)
    for (const [table, records] of Object.entries(out.rows)) {
      const body = sql.match(new RegExp(`CREATE TABLE migration_v2\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1]
      expect(body, table).toBeDefined()
      for (const key of new Set(records.flatMap(Object.keys))) expect(body).toMatch(new RegExp(`\\b${key}\\s`))
    }
    const mappingBody = sql.match(/CREATE TABLE migration_v2\.legacy_ids \(([\s\S]*?)\n\);/)[1]
    expect(mappingBody).toContain('UNIQUE (batch_id, table_name, source_path)')
  })
})
