import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { convert } from './convert.js'
import { reconcile, legacyEarned } from './reconcile.js'
import { classA } from "./__fixtures__/classes.js"
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

it("R5 獨立找回被清空的來源錯誤且拒絕匯入", () => {
  const source = structuredClone(classA)
  source.data.students[0].bank.balance = 999
  source.data.students[0].bank.transactions[0].balance = 999
  source.data.settings.extra = true
  const out = convert(source)
  const errors = structuredClone(out.errors)
  out.errors = []
  out.rows.migration_batches[0].validation_errors = []
  const audit = reconcile(source, out)
  expect(audit.ready_for_import).toBe(false)
  expect(audit.source_errors).toEqual(expect.arrayContaining(errors))
  expect(audit.differences.some(d => d.path === "errors")).toBe(true)
})
it("R5 偽造多報及改寫錯誤也列差異", () => {
  const source = snapshot()
  const out = convert(source)
  out.errors.push({ code: "UNKNOWN_FIELD", path: "/fake", value: true })
  out.rows.migration_batches[0].validation_errors = structuredClone(out.errors)
  expect(reconcile(source, out).differences.some(d => d.path === "errors")).toBe(true)
  out.errors[0].value = 999
  expect(reconcile(source, out).matches).toBe(false)
})

it("R5 每一筆既有來源錯誤少報都獨立識別", () => {
  const source = structuredClone(classA)
  source.data.settings.unknown = 1
  source.data.students[0].inventory.push({ itemId: "absent" })
  source.data.settings.jobAssignments.absent = ["absent"]
  source.data.students[0].bank.transactions[0].balance = 999
  const baseline = convert(source)
  expect(baseline.errors.map(e => e.code)).toEqual(expect.arrayContaining(["ORPHAN_PRODUCT", "ORPHAN_JOB", "ORPHAN_STUDENT", "ORPHAN_TASK", "TOTAL_EARNED_DRIFT", "TRANSACTION_BALANCE_DRIFT", "UNKNOWN_STATUS", "UNKNOWN_FIELD"]))
  for (let i = 0; i < baseline.errors.length; i++) {
    const out = structuredClone(baseline)
    out.errors.splice(i, 1)
    out.rows.migration_batches[0].validation_errors = structuredClone(out.errors)
    const audit = reconcile(source, out)
    expect(audit.source_errors).toEqual(expect.arrayContaining(baseline.errors))
    expect(audit.differences.some(d => d.path === "errors")).toBe(true)
    expect(audit.ready_for_import).toBe(false)
  }
})

it.each([[101, "101", false], [101, 101, true], [null, null, false], ["null", null, false], [0, 0, true], ["", "", true]])("R6 更正外鍵嚴格比對 %s 與 %s", (id, target, linked) => {
  const source = snapshot([{ id, amount: 10 }, { id: "fix", amount: 1, type: "correction", correctedTxId: target }])
  const out = convert(source)
  expect(out.rows.transactions[1].corrected_transaction_id).toBe(linked ? out.rows.transactions[0].id : null)
  expect(reconcile(source, out).differences).toEqual([])
})
it("R6 區間統計讀轉換外鍵並驗證指錯及清空", () => {
  const source = snapshot([{ id: "buy", amount: -30, reason: "購買 假卡", date: "2026-09-01" }, { id: "fix", amount: 10, type: "correction", correctedTxId: "buy", date: "2026-09-02" }, { id: "award", amount: 100, date: "2026-09-03" }])
  source.data.settings.semesterPeriods = { midterm: { start: "2026-09-01", end: "2026-09-30" } }
  for (const corrupt of [null, "award"]) {
    const out = convert(source)
    out.rows.transactions[1].corrected_transaction_id = corrupt === null ? null : out.rows.transactions[2].id
    const paths = reconcile(source, out).differences.map(d => d.path)
    expect(paths.some(p => p.endsWith("/corrected_transaction_id"))).toBe(true)
    expect(paths).toContain("/data/students/0/period/midterm")
  }
})

it.each([["on_time"], "on_time", null, 7, false])("R7 非物件學生狀態容器一致隔離 %s", values => {
  const source = snapshot()
  source.data.logs = [{ tasks: [{ id: "0" }], status: { s: values } }]
  const out = convert(source)
  expect(out.errors).toContainEqual({ code: "INVALID_OBJECT", path: "/data/logs/0/status/s", value: values })
  expect(out.rows.submissions[0]).toMatchObject({ status: "pending", present: false, raw: null })
  expect(reconcile(source, out).differences).toEqual([])
})
it.each([[], "bad", null, 7, false])("R7 非物件 log 狀態容器一致隔離 %s", status => {
  const source = snapshot()
  source.data.logs = [{ tasks: [{ id: "0" }], status }]
  const out = convert(source)
  expect(out.rows.submissions).toEqual([])
  expect(reconcile(source, out).differences).toEqual([])
})

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
  return value
}
it("R8 深層物件鍵順序不改雜湊，陣列順序會改", () => {
  const source = snapshot([{ id: "a", amount: 1 }, { id: "b", amount: 2 }])
  const original = convert(source)
  const reordered = reverseKeys(source)
  expect(convert(reordered).rows.migration_batches).toEqual(original.rows.migration_batches)
  expect(convert(reordered).report.source_hash).toBe(original.report.source_hash)
  expect(reconcile(reordered, original).differences).toEqual([])
  reordered.data.students[0].bank.transactions.reverse()
  expect(convert(reordered).rows.migration_batches[0].id).not.toBe(original.rows.migration_batches[0].id)
  expect(convert(reordered).report.source_hash).not.toBe(original.report.source_hash)
})

it.each([1, "1", "unassigned", null])("R9 組別關聯型別一致且 raw 保留 %s", group => {
  const source = snapshot()
  source.data.students[0].group = group
  const out = convert(source)
  expect(out.rows.students[0].group_key).toBe(group == null ? null : String(group))
  expect(out.rows.students[0].raw.group).toBe(group)
  if (group === 1 || group === "1") expect(out.rows.students[0].group_key).toBe(out.rows.groups[0].group_key)
  expect(reconcile(source, out).differences).toEqual([])
  const sql = readFileSync(new URL("./schema-v2.sql", import.meta.url), "utf8")
  expect(sql.includes("group_key jsonb")).toBe(false)
})

it("R10 原測試宣稱的隔離行為逐筆斷言", () => {
  const source = structuredClone(classA)
  source.data.students[0].bank.transactions.push({ id: "t1", amount: "NaN", type: "correction", correctedTxId: "absent" })
  source.data.students[0].bank.transactions[0].correctedTxId = "t3"
  source.data.students[0].bank.transactions[2].correctedTxId = "t3"
  const out = convert(source)
  const txs = out.rows.transactions.filter(t => t.student_id === out.rows.students[0].id)
  expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(["DUPLICATE_LEGACY_ID", "AMBIGUOUS_REFERENCE", "INVALID_AMOUNT", "ORPHAN_CORRECTION", "CORRECTION_CYCLE"]))
  expect(txs[1].corrected_transaction_id).toBeNull()
  expect(txs[2].corrected_transaction_id).toBeNull()
  expect(txs.at(-1)).toMatchObject({ corrected_transaction_id: null, amount: null, raw: { amount: "NaN" } })
})

it("R11 保留字串金額舊語意但由 INVALID_AMOUNT 擋匯入", () => {
  const txs = [{ id: "a", amount: "100" }, { id: "b", amount: "25" }]
  expect(legacyEarned(txs)).toBe("010025")
  expect(legacyEarned(txs)).toBe(calcEarnedFromTransactions(txs))
  const source = snapshot(txs)
  const out = convert(source)
  expect(out.errors.filter(e => e.code === "INVALID_AMOUNT")).toHaveLength(2)
  expect(out.rows.accounts[0].earned_recomputed).toBeNull()
  expect(reconcile(source, out).ready_for_import).toBe(false)
  expect(readme().includes("字串金額會串接")).toBe(true)
})

it.each([0, ""])("R6 零值編號外鍵有效但區間保留舊 helper 的 truthy 判斷 %s", id => {
  const source = snapshot([{ id, amount: -30, reason: "購買 假卡", date: "2026-09-01" }, { id: "fix", amount: 10, type: "correction", correctedTxId: id, date: "2026-09-02" }])
  source.data.settings.semesterPeriods = { midterm: { start: "2026-09-01" } }
  const out = convert(source)
  expect(out.rows.transactions[1].corrected_transaction_id).toBe(out.rows.transactions[0].id)
  expect(reconcile(source, out).differences).toEqual([])
  expect(reconcile(source, out).students[0].periods.midterm).toBe(10)
})
