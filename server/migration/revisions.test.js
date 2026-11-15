import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { convert } from './convert.js'
import { reconcile } from './reconcile.js'
import { calcEarnedFromTransactions } from '../../src/utils/helpers.js'

function snapshot(transactions = []) {
  return { classId: 'revision', data: { classId: 'revision', updatedAt: '2026-11-15', students: [{ id: 's', group: 1, bank: { transactions } }], settings: { groupAliases: { 1: '第一組' } }, logs: [] } }
}
const readme = () => readFileSync(new URL('./README.md', import.meta.url), 'utf8')

describe('退修回歸', () => {
  it('R1 多跳商店更正與舊 helper、逐步累計相等', () => {
    const txs = [{ id: 'award', amount: 100, reason: '獎勵' }, { id: 'buy', amount: -30, reason: '購買 假卡' }]
    let totalEarned = 100
    for (const [id, target, newAmount] of [['fix1', 'buy', -40], ['fix2', 'fix1', -5]]) {
      const original = txs.find(t => t.id === target)
      const amount = newAmount - original.amount
      const isStore = /^(購買|使用道具)/.test(original.reason)
      totalEarned += isStore ? 0 : amount
      original.voided = true
      txs.push({ id, amount, reason: `修正：${original.reason}`, type: 'correction', correctedTxId: target })
    }
    const source = snapshot(txs)
    source.data.students[0].bank.totalEarned = totalEarned
    expect(totalEarned).toBe(105)
    expect(convert(source).rows.accounts[0].earned_recomputed).toBe(calcEarnedFromTransactions(txs))
    expect(convert(source).rows.accounts[0].earned_recomputed).toBe(totalEarned)
    expect(readme()).toContain('第二次更正差額會加入累計')
  })
})

it.each(["shop", "storeItems"])("R2 商品說明保全且不誤報 %s", location => {
  const source = snapshot()
  const product = { id: "p", description: "說明" }
  if (location === "shop") source.data.settings.shop = { products: [product] }
  else source.data.settings.storeItems = [product]
  const out = convert(source)
  expect(out.errors.filter(e => e.code === "UNKNOWN_FIELD")).toEqual([])
  expect(out.rows.products[0].raw.description).toBe("說明")
})

it("R3 循環每筆外鍵清空，含自循環與通往循環的尾鏈", () => {
  const source = snapshot([{ id: "a", amount: 1, correctedTxId: "b" }, { id: "b", amount: 2, correctedTxId: "a" }, { id: "c", amount: 3, correctedTxId: "c" }, { id: "tail", amount: 0, correctedTxId: "a" }])
  const out = convert(source)
  expect(out.rows.transactions.slice(0, 3).map(t => t.corrected_transaction_id)).toEqual([null, null, null])
  expect(out.errors.filter(e => e.code === "CORRECTION_CYCLE")).toHaveLength(3)
  expect(out.rows.transactions[3].corrected_transaction_id).toBe(out.rows.transactions[0].id)
  expect(reconcile(source, out).differences).toEqual([])
})

it("R4 重複交易隔離外鍵但重算沿用最後一筆", () => {
  const txs = [{ id: "dup", amount: 100, reason: "獎勵", voided: true }, { id: "dup", amount: -30, reason: "購買 貼紙", voided: true }, { id: "fix", amount: -20, type: "correction", correctedTxId: "dup" }]
  const out = convert(snapshot(txs))
  expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(["DUPLICATE_LEGACY_ID", "AMBIGUOUS_REFERENCE"]))
  expect(out.rows.transactions[2].corrected_transaction_id).toBeNull()
  expect(out.rows.accounts[0].earned_recomputed).toBe(calcEarnedFromTransactions(txs))
  expect(out.rows.accounts[0].earned_recomputed).toBe(0)
  expect(readme().includes("重複交易編號的累計重算仍取最後一筆")).toBe(true)
})
