import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addOverdueEffect, createRound, setEnrollment, setupCorrectionTask } from './test-support/correction-rounds.js'
import {
  addImportedDeduction, addImportedEffect, importedDeduction, importedFixture, readEffect, resolveLegacyEffect,
} from './test-support/legacy-effects.js'
import { adjustment, submit } from './test-support/operations.js'
import { commitOperation, saveRule, voidTask } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function link(target, transactionId = target.transactionId, fields = {}, version) {
  return resolveLegacyEffect(target, 'link', { transaction_id: transactionId, ...fields }, version)
}

async function expectUnchangedRejection(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ code, status: 'rejected', class_seq: null })
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}

async function ruleEffect(client, target, event) {
  const rule = saveRule(target.classId, { kind: 'event', event, amount: -4 })
  await commitOperation(client, rule)
  return rule.payload
}

describeDatabase('OP-53 裁決歷史效果', () => {
  const db = useTestDatabase()

  test('連結候選推進繳交版本與基準，只回繳交變更及裁決結果', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const before = await readEffect(client, target)
    const ledger = await importedDeduction(client, target)
    const receipt = await commitOperation(client, link(target))
    const detail = {
      effect_id: target.effectId, status: 'active', event: 'submission.missing',
      root_transaction_id: target.transactionId,
    }
    expect(await readEffect(client, target)).toEqual({ ...before, ...detail })
    const value = { status: 'missing', assignment_active: true }
    expect(await submissionRow(client, target)).toEqual({
      ...value, rev: 2, basis_rev: 2, last_op_id: receipt.op_id,
    })
    expect(receipt.changes).toEqual([{
      entity: 'submission', key: { task_id: target.taskId, student_id: target.studentId },
      prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 2,
      prev_value: value, value, last_op_id: receipt.op_id,
    }])
    expect(receipt.result).toEqual({
      noop: false, transactions: [], effects_added: [], effects_reversed: [],
      legacy_effect: { ...detail, resolution: 'link' },
    })
    expect(receipt.warnings).toEqual([])
    expect(receipt.class_seq).toBe(1)
    expect(await importedDeduction(client, target)).toEqual(ledger)
  })

  test('可以選與候選不同且只被其他效果建議的合格舊交易', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true, students: ['enrolled', 'enrolled'] })
    const other = await addImportedDeduction(client, target)
    await addImportedEffect(client, { ...target, studentId: target.studentIds[1] }, { suggested: other })
    await commitOperation(client, link(target, other))
    expect(await readEffect(client, target)).toMatchObject({
      root_transaction_id: other, suggested_transaction_id: target.transactionId,
    })
  })

  test.each([
    ['late', undefined, 'submission.late'],
    ['makeup', 'submission.late', 'submission.late'],
    ['makeup', 'submission.missing', 'submission.missing'],
  ])('%s 裁決時輸入 %s 產生事件 %s', async (status, event, wanted) => {
    const { client } = db()
    const target = await importedFixture(client, { status, suggested: true })
    const receipt = await commitOperation(client, link(target, target.transactionId, event ? { event } : {}))
    expect(receipt.result.legacy_effect.event).toBe(wanted)
    expect((await readEffect(client, target)).event).toBe(wanted)
  })

  test('判定未扣分只改歷史效果狀態並推進繳交版本', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const before = await readEffect(client, target)
    const ledger = await importedDeduction(client, target)
    const receipt = await commitOperation(client, resolveLegacyEffect(target, 'none'))
    expect(await readEffect(client, target)).toEqual({ ...before, status: 'dismissed' })
    expect(await submissionRow(client, target)).toMatchObject({ rev: 2, basis_rev: 2, last_op_id: receipt.op_id })
    expect(receipt.result.legacy_effect).toEqual({
      effect_id: target.effectId, resolution: 'none', status: 'dismissed', event: null, root_transaction_id: null,
    })
    expect(await importedDeduction(client, target)).toEqual(ledger)
  })

  test.each([['link', 'link'], ['link', 'none'], ['none', 'link']])('%s 之後拒絕再次裁決 %s', async (first, second) => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const op = resolution => resolution === 'link' ? link(target) : resolveLegacyEffect(target, resolution)
    await commitOperation(client, op(first))
    await expectUnchangedRejection(client, { ...op(second), expect: { rev: 2 } }, 'INVALID_TRANSITION')
  })

  test('已對應、已沖回、新版作業效果都不能裁決', async () => {
    const { client } = db()
    const target = await importedFixture(client, { linked: true })
    await expectUnchangedRejection(client, resolveLegacyEffect(target, 'none'), 'INVALID_TRANSITION')
    await commitOperation(client, setStatus(target, 'on_time'))
    await expectUnchangedRejection(client, resolveLegacyEffect(target, 'none'), 'INVALID_TRANSITION')
    await ruleEffect(client, target, 'submission.missing')
    const marked = await commitOperation(client, setStatus(target, 'missing', { rev: 2 }))
    await expectUnchangedRejection(client, resolveLegacyEffect({
      ...target, effectId: marked.result.effects_added[0].effect_id,
    }, 'none'), 'INVALID_TRANSITION')
  })

  test('新版訂正效果依狀態回 INVALID_TRANSITION', async () => {
    const { client } = db()
    const target = await createRound(client, await setupCorrectionTask(client))
    const rule = await ruleEffect(client, target, 'correction.overdue')
    const { effectId } = await addOverdueEffect(client, target, rule)
    await expectUnchangedRejection(client, resolveLegacyEffect({ ...target, effectId }, 'none'), 'INVALID_TRANSITION')
  })

  test.each([
    ['其他學生', async (client, target) => addImportedDeduction(client, { ...target, studentId: target.studentIds[1] })],
    ['新版交易', async (client, target) => (await commitOperation(client, adjustment(target))).result.transactions[0]],
    ['舊購買', (client, target) => addImportedDeduction(client, target, { kind: 'shop_purchase', earned: 0 })],
    ['舊更正', (client, target) => addImportedDeduction(client, target, {
      kind: 'correction', amount: 1, root: target.transactionId,
    })],
    ['孤立更正', (client, target) => addImportedDeduction(client, target, { kind: 'legacy_orphan_correction' })],
    ['有效金額為零', async (client, target) => {
      await addImportedDeduction(client, target, { kind: 'correction', amount: 6, root: target.transactionId })
      return target.transactionId
    }],
    ['正金額', (client, target) => addImportedDeduction(client, target, { amount: 2 })],
    ['已連著其他效果', async (client, target) => {
      await addImportedEffect(client, { ...target, studentId: target.studentIds[1] }, {
        status: 'reversed', event: 'submission.missing', root: target.transactionId,
      })
      return target.transactionId
    }],
    ['無歸屬時間', (client, target) => addImportedDeduction(client, target, { effectiveAt: null })],
  ])('%s 拒絕連結且資料不變', async (_label, transaction) => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true, students: ['enrolled', 'enrolled'] })
    await expectUnchangedRejection(client, link(target, await transaction(client, target)), 'TX_NOT_REVERSIBLE')
  })

  test('臺灣發布日前一秒拒絕，當日零點可連結', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    const tooEarly = await addImportedDeduction(client, target, { occurredAt: '2026-08-31T23:59:59+08:00' })
    const sameDay = await addImportedDeduction(client, target, { occurredAt: '2026-09-01T00:00:00+08:00' })
    await expectUnchangedRejection(client, link(target, tooEarly), 'TX_NOT_REVERSIBLE')
    await commitOperation(client, link(target, sameDay))
    expect((await readEffect(client, target)).root_transaction_id).toBe(sameDay)
  })

  test.each(['effect_id', 'transaction_id'])('找不到 %s 時省略 current', async (key) => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const op = link(target, target.transactionId, { [key]: '不存在' })
    const receipt = await expectUnchangedRejection(client, op, 'NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  })

  test.each([
    ['少了效果編號', { effect_id: undefined }],
    ['答案不合法', { resolution: 'other' }],
    ['連結缺交易', { resolution: 'link' }],
    ['未扣分帶交易', { transaction_id: '舊交易' }],
    ['未扣分帶事件', { event: 'submission.missing' }],
    ['事件值不合法', { resolution: 'link', transaction_id: '舊交易', event: 'other' }],
    ['多餘鍵', { extra: 1 }],
  ])('%s 回輸入錯誤', async (_label, fields) => {
    const { client } = db()
    const target = await importedFixture(client)
    await expectUnchangedRejection(client, resolveLegacyEffect(target, 'none', fields), 'INVALID_PAYLOAD')
  })

  test.each([
    ['省略', undefined], ['JSON null', null], ['兩種條件', { rev: 1, after_op: '操作' }],
  ])('版本條件為%s回輸入錯誤', async (_label, version) => {
    const { client } = db()
    const target = await importedFixture(client)
    const op = { ...resolveLegacyEffect(target, 'none'), expect: version }
    await expectUnchangedRejection(client, op, 'INVALID_PAYLOAD')
  })

  test.each([['makeup', undefined], ['missing', 'submission.missing']])('%s 與事件 %s 不相容', async (status, event) => {
    const { client } = db()
    const target = await importedFixture(client, { status, suggested: true })
    const op = link(target, target.transactionId, { event })
    await expectUnchangedRejection(client, op, 'INVALID_PAYLOAD')
  })

  test.each([0, 2])('版本 %s 不符且回當前繳交', async (rev) => {
    const { client } = db()
    const target = await importedFixture(client)
    const receipt = await expectUnchangedRejection(client, resolveLegacyEffect(target, 'none', {}, { rev }), 'STALE_STATE')
    expect(receipt.current).toEqual({
      rev: 1, value: { status: 'missing', assignment_active: true }, last_op_id: null, actor: null, committed_at: null,
    })
  })

  test('裁決可接在改補交的操作之後', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const makeup = await commitOperation(client, setStatus(target, 'makeup'))
    const receipt = await commitOperation(client, link(target, target.transactionId, {
      event: 'submission.late',
    }, { after_op: makeup.op_id }))
    expect(receipt.changes[0]).toMatchObject({ rev: 3, basis_rev: 3 })
  })

  test('已裁決優先於版本，版本優先於交易條件', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const positive = await addImportedDeduction(client, target, { amount: 1 })
    const stale = link(target, positive, {}, { rev: 2 })
    await expectUnchangedRejection(client, stale, 'STALE_STATE')
    await commitOperation(client, resolveLegacyEffect(target, 'none'))
    await expectUnchangedRejection(client, link(target, positive), 'INVALID_TRANSITION')
  })

  test('小野不能裁決，老師不能寫封存班', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    await authorizeAgent(client, target.classId)
    const { receipts } = await agentSubmit(client, target.classId, [resolveLegacyEffect(target, 'none')])
    expect(receipts[0].code).toBe('FORBIDDEN_ROLE')
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [target.classId])
    await expectUnchangedRejection(client, resolveLegacyEffect(target, 'none'), 'CLASS_ARCHIVED')
  })

  test('作業已作廢仍可連結，學生轉出仍可否決', async () => {
    const { client } = db()
    const voided = await importedFixture(client, { suggested: true })
    await commitOperation(client, voidTask(voided.classId, voided.taskId, false))
    await commitOperation(client, link(voided))
    const transferred = await importedFixture(client)
    await setEnrollment(client, transferred, 'transferred')
    await commitOperation(client, resolveLegacyEffect(transferred, 'none'))
  })

  test('已有同目標同事件的有效效果時定案拒絕', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    const other = await addImportedDeduction(client, target)
    await addImportedEffect(client, target, { status: 'active', event: 'submission.missing', root: other })
    await expectUnchangedRejection(client, link(target), 'INVALID_TRANSITION')
  })
})
