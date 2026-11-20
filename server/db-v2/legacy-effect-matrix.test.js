import { expect, test } from 'vitest'
import {
  addImportedDeduction, importedDeduction, importedFixture, readEffect, resolveLegacyEffect,
} from './test-support/legacy-effects.js'
import { submit } from './test-support/operations.js'
import { commitOperation, saveRule } from './test-support/schoolwork.js'
import { saveEventRule } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse, transactionFrom } from './test-support/transactions.js'

const oldAmount = -6
const oldTime = new Date('2026-09-10T12:00:00+08:00')
const currentAmounts = { late: -3, missing: -9 }

const matrix = [
  ['late', 'late', 'exempt', true, null],
  ['late', 'late', 'late', false, null],
  ['late', 'late', 'missing', true, 'missing'],
  ['late', 'late', 'makeup', false, null],
  ['missing', 'missing', 'on_time', true, null],
  ['missing', 'missing', 'late', true, 'late'],
  ['missing', 'missing', 'missing', false, null],
  ['missing', 'missing', 'makeup', false, null],
  ['makeup', 'late', 'pending', true, null],
  ['makeup', 'late', 'late', false, null],
  ['makeup', 'late', 'missing', true, 'missing'],
  ['makeup', 'late', 'makeup', false, null],
  ['makeup', 'missing', 'exempt', true, null],
  ['makeup', 'missing', 'late', true, 'late'],
  ['makeup', 'missing', 'missing', false, null],
]

async function saveCurrentRules(client, classId) {
  const rules = {}
  for (const [name, amount] of Object.entries(currentAmounts)) {
    const rule = await saveEventRule(client, classId, 'submission.' + name, amount - 1)
    await commitOperation(client, saveRule(classId, { ...rule, amount }, 1))
    rules[name] = rule.rule_id
  }
  return rules
}

async function expectImportedReversal(client, receipt, target, effective = oldAmount) {
  const entry = await transactionFrom(client, receipt)
  expect(entry).toMatchObject({
    kind: 'reversal', amount: String(-effective), earned_delta: String(-effective),
    root_transaction_id: target.transactionId, occurred_at: new Date(receipt.committed_at), effective_at: oldTime,
  })
  expect(await readEffect(client, target)).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
  expect(receipt.result.effects_reversed).toHaveLength(1)
  expect(receipt.result.effects_reversed[0]).toMatchObject({
    effect_id: target.effectId, effective_amount: effective, rule_id: null, rule_rev: null,
  })
}

async function expectCurrentDeduction(client, receipt, index, status, ruleId) {
  const entry = await transactionFrom(client, receipt, index)
  expect(entry).toMatchObject({
    kind: 'rule_auto', amount: String(currentAmounts[status]), rule_id: ruleId, rule_rev: 2,
  })
  expect(receipt.result.effects_added).toHaveLength(1)
  const { effect_id: effectId } = receipt.result.effects_added[0]
  expect(await readEffect(client, { classId: entry.class_id, effectId })).toMatchObject({
    status: 'active', origin: 'op', event: 'submission.' + status, rule_id: ruleId, rule_rev: 2,
    root_transaction_id: entry.transaction_id,
  })
}

function link(target) {
  return resolveLegacyEffect(target, 'link', { transaction_id: target.transactionId })
}

describeDatabase('歷史效果與 6.4 矩陣', () => {
  const db = useTestDatabase()

  test('裁決後的 after_op 接上繳交版本並沖回剛連結的舊交易', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const resolved = await commitOperation(client, link(target))
    const changed = await commitOperation(client, setStatus(target, 'on_time', { after_op: resolved.op_id }))
    await expectImportedReversal(client, changed, target)
    expect(await submissionRow(client, target)).toMatchObject({ rev: 3, basis_rev: 3, status: 'on_time' })
    expect(await importedDeduction(client, target)).toEqual({ balance: 0, count: 2 })
  })

  test('裁決後沿用舊版號時回目前版本與裁決編號', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const resolved = await commitOperation(client, link(target))
    const stale = await submit(client, setStatus(target, 'on_time'))
    expect(stale).toMatchObject({ code: 'STALE_STATE', current: { rev: 2, last_op_id: resolved.op_id } })
  })

  test('被拒絕的裁決無法作為下一筆狀態變更的版本', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    target.transactionId = await addImportedDeduction(client, target, { amount: 2 })
    const resolved = await submit(client, link(target))
    expect(resolved.code).toBe('TX_NOT_REVERSIBLE')
    const stale = await submit(client, setStatus(target, 'on_time', { after_op: resolved.op_id }))
    expect(stale).toMatchObject({ code: 'STALE_STATE', current: { rev: 1, last_op_id: null } })
  })

  test('舊根交易負十經舊更正加四後，改準時退六', async () => {
    const { client } = db()
    const target = await importedFixture(client, { linked: true, amount: -10 })
    await saveCurrentRules(client, target.classId)
    await addImportedDeduction(client, target, { kind: 'correction', amount: 4, root: target.transactionId })
    const receipt = await commitOperation(client, setStatus(target, 'on_time'))
    await expectImportedReversal(client, receipt, target, -6)
    expect(await importedDeduction(client, target)).toEqual({ balance: 0, count: 3 })
  })

  test('已對應缺交改補交再改回缺交，兩步皆沿用原效果', async () => {
    const { client } = db()
    const target = await importedFixture(client, { linked: true })
    await saveCurrentRules(client, target.classId)
    const original = await readEffect(client, target)
    const makeup = await commitOperation(client, setStatus(target, 'makeup'))
    const missing = await commitOperation(client, setStatus(target, 'missing', { rev: 2 }))
    expect(makeup.result.transactions).toEqual([])
    expect(missing.result.transactions).toEqual([])
    expect(await readEffect(client, target)).toEqual(original)
    expect(await importedDeduction(client, target)).toEqual({ balance: oldAmount, count: 1 })
  })

  test.each(['on_time', 'late'])('否決後改 %s 時按沒有有效扣分處理', async (status) => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const rules = await saveCurrentRules(client, target.classId)
    const resolved = await commitOperation(client, resolveLegacyEffect(target, 'none'))
    const marked = await commitOperation(client, setStatus(target, status, { after_op: resolved.op_id }))
    expect(marked.result.effects_reversed).toEqual([])
    expect((await readEffect(client, target)).status).toBe('dismissed')
    if (status === 'late') {
      await expectCurrentDeduction(client, marked, 0, status, rules[status])
      expect(await importedDeduction(client, target)).toEqual({ balance: oldAmount + currentAmounts.late, count: 2 })
    } else {
      expect(marked.result.transactions).toEqual([])
      expect(await importedDeduction(client, target)).toEqual({ balance: oldAmount, count: 1 })
    }
  })

  test.each(matrix)('%s 帶 %s 扣分改 %s｜沖回 %s、新增 %s', async (from, oldEvent, to, reverseOld, added) => {
    const { client } = db()
    const target = await importedFixture(client, { status: from, linked: true, event: 'submission.' + oldEvent })
    const rules = await saveCurrentRules(client, target.classId)
    const receipt = await commitOperation(client, setStatus(target, to))
    expect(receipt.result.noop).toBe(from === to)
    expect(receipt.result.transactions).toHaveLength(Number(reverseOld) + Number(Boolean(added)))
    if (reverseOld) {
      await expectImportedReversal(client, receipt, target)
    } else {
      expect(receipt.result.effects_reversed).toEqual([])
      expect(await readEffect(client, target)).toMatchObject({
        status: 'active', reversed_op_id: null, root_transaction_id: target.transactionId,
      })
    }
    if (added) {
      await expectCurrentDeduction(client, receipt, Number(reverseOld), added, rules[added])
    } else {
      expect(receipt.result.effects_added).toEqual([])
    }
    const rev = from === to ? 1 : 2
    expect(await submissionRow(client, target)).toMatchObject({ rev, basis_rev: rev, assignment_active: true, status: to })
    expect(await importedDeduction(client, target)).toEqual({
      balance: (reverseOld ? 0 : oldAmount) + (added ? currentAmounts[added] : 0),
      count: 1 + receipt.result.transactions.length,
    })
  })

  test('單獨沖回後改準時不再退，改回缺交用現行規則', async () => {
    const { client } = db()
    const target = await importedFixture(client, { linked: true })
    const rules = await saveCurrentRules(client, target.classId)
    const reversed = await commitOperation(client, reverse(target.classId, target.transactionId, oldAmount))
    await expectImportedReversal(client, reversed, target)
    const onTime = await commitOperation(client, setStatus(target, 'on_time'))
    expect(onTime.result.transactions).toEqual([])
    const missing = await commitOperation(client, setStatus(target, 'missing', { rev: 2 }))
    expect(missing.result.effects_reversed).toEqual([])
    await expectCurrentDeduction(client, missing, 0, 'missing', rules.missing)
    expect(await importedDeduction(client, target)).toEqual({ balance: currentAmounts.missing, count: 3 })
  })
})
