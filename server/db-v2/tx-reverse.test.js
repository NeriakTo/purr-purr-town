import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { addProduct, purchase } from './test-support/shop.js'
import { assignTask, balanceOf, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { addLegacyTransaction, correct, reverse, transactionFrom } from './test-support/transactions.js'

describeDatabase('OP-27 沖回根交易', () => {
  const db = useTestDatabase()

  test.each([100, 80])('根交易有效金額 %i，沖回採反號與原日期', async (amount) => {
    const { client } = db()
    const target = await addClass(client)
    const root = await transactionFrom(client, await commitOperation(client, adjustment(target, 100)))
    let id = root.transaction_id
    if (amount !== 100) id = (await commitOperation(client, correct(target.classId, id, 100, amount))).result.transactions[0]
    const receipt = await commitOperation(client, reverse(target.classId, id, amount))
    expect(receipt.result.effects_reversed).toEqual([])
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'reversal', amount: String(-amount), earned_delta: String(-amount),
      root_transaction_id: root.transaction_id, effective_at: root.effective_at,
    })
    expect(receipt.changes[0].value).toEqual({ balance: 0, total_earned: 0 })
    for (const op of [reverse(target.classId, id, 0), correct(target.classId, id, 0, 10)]) {
      expect(await submit(client, op)).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    }
  })

  test('有效金額零時禁止手動沖回，但仍可更正', async () => {
    const { client } = db()
    const target = await addClass(client)
    const id = (await commitOperation(client, adjustment(target, 10))).result.transactions[0]
    await commitOperation(client, correct(target.classId, id, 10, 0))
    expect(await submit(client, reverse(target.classId, id, 0))).toMatchObject({ code: 'TX_ALREADY_REVERSED' })
    await commitOperation(client, correct(target.classId, id, 0, -5))
    expect(await balanceOf(client, target)).toBe(-5)
  })

  test.each([['on_time', []], ['late', ['rule_auto']]])(
    '手動退缺交扣分後改 %s，只產生新狀態所需交易', async (status, kinds) => {
      const { client } = db()
      const target = await assignTask(client, await addClass(client))
      const rule = await saveEventRule(client, target.classId, 'submission.missing', -10)
      await saveEventRule(client, target.classId, 'submission.late', -5)
      const marked = await markSubmission(client, target, 'missing')
      const id = marked.result.transactions[0]
      const before = await submissionRow(client, target)
      const receipt = await commitOperation(client, reverse(target.classId, id, -10))
      const { rows: [effect] } = await client.query('SELECT * FROM ppt.effects WHERE class_id = $1', [target.classId])
      expect(effect).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
      expect(receipt.result.effects_reversed).toEqual([{
        effect_id: effect.effect_id, lineage_id: effect.lineage_id, event: 'submission.missing',
        subject_kind: 'task', subject_key: target.taskId, root_transaction_id: id,
        rule_id: rule.rule_id, rule_rev: 1, effective_amount: -10, effective_at: marked.committed_at,
      }])
      expect(await submissionRow(client, target)).toEqual(before)
      const changed = await markSubmission(client, target, status, 2)
      const entries = await Promise.all(changed.result.transactions.map((_id, index) => transactionFrom(client, changed, index)))
      expect(entries.map(entry => entry.kind)).toEqual(kinds)
    },
  )

  test('手動沖回每日任務不重判，也不推進繳交版本', async () => {
    const { client } = db()
    const target = await assignTask(client, await addClass(client))
    await saveEventRule(client, target.classId, 'daily_quest.complete', 10)
    const marked = await markSubmission(client, target, 'on_time')
    const before = await submissionRow(client, target)
    const receipt = await commitOperation(client, reverse(target.classId, marked.result.transactions[0], 10))
    expect(receipt.result).toMatchObject({ effects_added: [], effects_reversed: [{ event: 'daily_quest.complete' }] })
    expect(receipt.result.transactions).toHaveLength(1)
    const { rows } = await client.query('SELECT status FROM ppt.effects WHERE class_id = $1', [target.classId])
    expect(rows).toEqual([{ status: 'reversed' }])
    expect(await submissionRow(client, target)).toEqual(before)
  })

  test('匯入的已對應效果隨舊根交易沖回，快照規則欄位為空', async () => {
    const { client } = db()
    const target = await assignTask(client, await addClass(client))
    const id = await addLegacyTransaction(client, target, { amount: -10 })
    const effectId = randomUUID()
    await client.query(`
      INSERT INTO ppt.effects (class_id, student_id, effect_id, lineage_id, event, subject_kind,
        subject_key, root_transaction_id, status, origin)
      VALUES ($1, $2, $3, $3, 'submission.missing', 'task', $4, $5, 'active', 'legacy')
    `, [target.classId, target.studentId, effectId, target.taskId, id])
    const receipt = await commitOperation(client, reverse(target.classId, id, -10))
    expect(receipt.result.effects_reversed).toMatchObject([{
      effect_id: effectId, rule_id: null, rule_rev: null, effective_amount: -10,
    }])
    const { rows } = await client.query('SELECT status FROM ppt.effects WHERE effect_id = $1', [effectId])
    expect(rows).toEqual([{ status: 'reversed' }])
  })

  test.each(['migration_opening_adjustment', 'legacy_orphan_correction', 'item_use'])('不沖回 %s', async (kind) => {
    const { client } = db()
    const target = await addClass(client)
    const id = await addLegacyTransaction(client, target, { kind })
    expect(await submit(client, reverse(target.classId, id, 99))).toMatchObject({ code: 'TX_NOT_REVERSIBLE' })
  })

  test('新版購買不能手動沖回，舊購買只退點數', async () => {
    const { client } = db()
    const target = await addClass(client)
    await commitOperation(client, adjustment(target, 10))
    const productId = await addProduct(client, target.classId)
    const bought = await commitOperation(client, purchase({ ...target, productId }))
    expect(await submit(client, reverse(target.classId, bought.result.transactions[0], -3)))
      .toMatchObject({ code: 'TX_NOT_REVERSIBLE' })
    const legacy = await addLegacyTransaction(client, target, { kind: 'shop_purchase', amount: -5, earned: 0 })
    const receipt = await commitOperation(client, reverse(target.classId, legacy, -5))
    expect(await transactionFrom(client, receipt)).toMatchObject({ amount: '5', earned_delta: '0' })
  })

  test('有效金額不符、帶多餘輸入或 expect 皆拒絕', async () => {
    const { client } = db()
    const target = await addClass(client)
    const id = (await commitOperation(client, adjustment(target, 10))).result.transactions[0]
    const op = reverse(target.classId, id, 5)
    expect(await submit(client, op)).toMatchObject({ code: 'STALE_STATE', current: { transaction_id: id, effective_amount: 10 } })
    const extra = reverse(target.classId, id, 10)
    extra.payload.other = '測試'
    for (const invalid of [extra, { ...reverse(target.classId, id, 10), expect: null }]) {
      expect(await submit(client, invalid)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })
})
