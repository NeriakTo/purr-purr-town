import { describe, it, expect } from 'vitest'
import {
  getCurrentSemester,
  resolveCurrency,
  createTransaction,
  calcEarnedFromTransactions,
  ensureStudentBank,
  normalizeStatus,
  isActiveStudent,
} from './helpers'
import { DEFAULT_CURRENCY } from './constants'

// 回歸基準：這些純函式在動任何複製設定邏輯之前先鎖住現行行為。

describe('getCurrentSemester 學期推算', () => {
  it('8-12 月為上學期，學年 = 西元 - 1911', () => {
    expect(getCurrentSemester(new Date(2026, 7, 15))).toBe('115-1') // 8 月
    expect(getCurrentSemester(new Date(2026, 11, 1))).toBe('115-1') // 12 月
  })
  it('1 月仍屬上學期，學年減一', () => {
    expect(getCurrentSemester(new Date(2026, 0, 10))).toBe('114-1')
  })
  it('2-7 月為下學期，學年減一', () => {
    expect(getCurrentSemester(new Date(2026, 5, 14))).toBe('114-2') // 6 月
    expect(getCurrentSemester(new Date(2026, 1, 1))).toBe('114-2') // 2 月
    expect(getCurrentSemester(new Date(2026, 6, 31))).toBe('114-2') // 7 月
  })
})

describe('resolveCurrency 貨幣解析', () => {
  it('空輸入回預設', () => {
    expect(resolveCurrency(null)).toEqual(DEFAULT_CURRENCY)
    expect(resolveCurrency(undefined)).toEqual(DEFAULT_CURRENCY)
  })
  it('完整 base/tier1/tier2 保留自訂名稱並套匯率', () => {
    const custom = {
      currency: {
        base: { name: '點', icon: '⭐' },
        tier1: { name: '魚', rate: 50, icon: '🐟' },
        tier2: { name: '餅', rate: 500, icon: '🍪' },
      },
    }
    const r = resolveCurrency(custom)
    expect(r.base.name).toBe('點')
    expect(r.tier1.rate).toBe(50)
    expect(r.tier2.rate).toBe(500)
  })
  it('非正匯率退回預設匯率', () => {
    const r = resolveCurrency({ currency: { base: { name: 'x' }, tier1: { rate: 0 }, tier2: { rate: -5 } } })
    expect(r.tier1.rate).toBe(DEFAULT_CURRENCY.tier1.rate)
    expect(r.tier2.rate).toBe(DEFAULT_CURRENCY.tier2.rate)
  })
})

describe('createTransaction 銀行交易', () => {
  it('一般收入累加 balance 與 totalEarned', () => {
    const bank = { balance: 100, totalEarned: 100, transactions: [] }
    const next = createTransaction(bank, 50, '發表優良')
    expect(next.balance).toBe(150)
    expect(next.totalEarned).toBe(150)
    expect(next.transactions).toHaveLength(1)
  })
  it('商店消費 excludeFromTotal 不動 totalEarned', () => {
    const bank = { balance: 200, totalEarned: 200, transactions: [] }
    const next = createTransaction(bank, -100, '購買減功課卡', { excludeFromTotal: true })
    expect(next.balance).toBe(100)
    expect(next.totalEarned).toBe(200)
  })
  it('不就地修改原 bank（不可變）', () => {
    const bank = { balance: 100, totalEarned: 100, transactions: [] }
    createTransaction(bank, 50, 'x')
    expect(bank.balance).toBe(100)
    expect(bank.transactions).toHaveLength(0)
  })
})

describe('calcEarnedFromTransactions 區間統計', () => {
  const tx = [
    { id: 'a', date: '2026-03-01T00:00:00Z', amount: 100, reason: '發表優良' },
    { id: 'b', date: '2026-03-02T00:00:00Z', amount: -50, reason: '購買午休免睡卡' },
    { id: 'c', date: '2026-03-03T00:00:00Z', amount: 200, reason: '全勤獎勵', voided: true },
    { id: 'd', date: '2026-03-04T00:00:00Z', amount: 30, reason: '作業優良' },
  ]
  it('排除商店消費與 voided', () => {
    expect(calcEarnedFromTransactions(tx)).toBe(130) // 100 + 30
  })
  it('空陣列回 0', () => {
    expect(calcEarnedFromTransactions([])).toBe(0)
    expect(calcEarnedFromTransactions(null)).toBe(0)
  })
})

describe('ensureStudentBank 向後相容遷移', () => {
  it('無 totalEarned 時從交易回算', () => {
    const student = { bank: { balance: 50, transactions: [{ id: 'x', amount: 50, reason: '獎勵' }] }, inventory: [] }
    const out = ensureStudentBank(student)
    expect(out.bank.totalEarned).toBe(50)
  })
  it('已完整時原樣回傳', () => {
    const student = { bank: { balance: 0, totalEarned: 0, transactions: [] }, inventory: [] }
    expect(ensureStudentBank(student)).toBe(student)
  })
})

describe('normalizeStatus / isActiveStudent', () => {
  it('normalizeStatus 對已知值穩定', () => {
    expect(normalizeStatus('on_time')).toBe('on_time')
  })
  it('inactive 學生非在籍', () => {
    expect(isActiveStudent({ inactive: true })).toBe(false)
    expect(isActiveStudent({})).toBe(true)
    expect(isActiveStudent({ inactive: false })).toBe(true)
  })
})
