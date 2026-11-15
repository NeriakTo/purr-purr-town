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
