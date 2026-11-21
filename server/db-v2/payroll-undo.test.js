import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { setEnrollment } from './test-support/correction-rounds.js'
import { addClass } from './test-support/operations.js'
import { addPayrollJob, payDuty, payrollDay, prepareDuty, retireJob, runPayroll, setCutover } from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { undo } from './test-support/undo.js'

async function arrangePayroll(client) {
  const fixture = await addClass(client, { students: Array(3).fill('enrolled') })
  const { classId, studentIds: [first, second, third] } = fixture
  const monthly = await addPayrollJob(client, classId, [first, second])
  const weekly = await addPayrollJob(client, classId, [second, third], { cycle: 'weekly', salary: 5 })
  const original = await commitOperation(client, runPayroll(classId, [monthly, weekly]))
  return { ...fixture, monthly, weekly, original }
}

function undoPayroll(client, { classId, original }) {
  return commitOperation(client, undo(classId, original.op_id))
}

async function expectZeroAccounts(client, classId, count) {
  const { rows } = await client.query(
    'SELECT balance, total_earned FROM ppt.accounts WHERE class_id = $1', [classId],
  )
  expect(rows).toEqual(Array.from({ length: count }, () => ({ balance: '0', total_earned: '0' })))
}

async function expectReversedEffects(client, classId, receipt, original) {
  const { rows } = await client.query(`
    SELECT effect_id, status, reversed_op_id FROM ppt.effects WHERE class_id = $1
  `, [classId])
  expect(rows).toHaveLength(original.result.effects_added.length)
  for (const { effect_id } of original.result.effects_added) {
    expect(rows).toContainEqual({ effect_id, status: 'reversed', reversed_op_id: receipt.op_id })
  }
}

async function expectUndoNoWrite(client, classId, original) {
  const options = { ignoreClassSequence: true }
  const before = await classSnapshot(client, classId, options)
  const receipt = await undoPayroll(client, { classId, original })
  expect(receipt).toMatchObject({
    changes: [], result: { noop: true, transactions: [], effects_reversed: [], undo: { target_op_id: original.op_id } },
  })
  expect(await classSnapshot(client, classId, options)).toBe(before)
  return receipt
}

describeDatabase('撤銷發薪 OP-50', () => {
  const database = useTestDatabase()

  it('依原收據沖回四筆月週薪資、結束效果並合併三位學生帳戶', async () => {
    const { client } = database()
    const fixture = await arrangePayroll(client)
    const { classId, studentIds, original } = fixture
    const receipt = await undoPayroll(client, fixture)
    expect(receipt.result).toMatchObject({
      noop: false, effects_added: [], undo: { target_op_id: original.op_id, skipped: [], amount_changed: [] },
    })
    expect(receipt.warnings).toEqual([])
    expect(receipt.result.transactions).toHaveLength(4)
    expect(receipt.result.effects_reversed).toHaveLength(4)
    for (const [index, { amount, ...effect }] of original.result.effects_added.entries()) {
      const root = await transactionFrom(client, original, index)
      const reversal = await transactionFrom(client, receipt, index)
      expect(reversal).toMatchObject({
        kind: 'reversal', root_transaction_id: root.transaction_id, amount: String(-amount),
        earned_delta: String(-amount), effective_at: root.effective_at, student_id: root.student_id,
      })
      const snapshot = receipt.result.effects_reversed[index]
      expect(snapshot).toMatchObject({ ...effect, rule_id: null, rule_rev: null, effective_amount: amount })
      expect(new Date(snapshot.effective_at)).toEqual(root.effective_at)
    }
    await expectReversedEffects(client, classId, receipt, original)
    await expectZeroAccounts(client, classId, 3)
    expect(receipt.changes.map(({ key }) => key.student_id)).toEqual([...studentIds].sort())
    expect(receipt.changes.find(({ key }) => key.student_id === studentIds[1])).toMatchObject({
      entity: 'account', prev_rev: 3, rev: 5, prev_value: { balance: 15, total_earned: 15 },
      value: { balance: 0, total_earned: 0 },
    })
    await rejectUndoWithoutChanges(client, undo(classId, original.op_id), 'ALREADY_UNDONE')
    const reissued = await commitOperation(client, runPayroll(classId, [fixture.monthly, fixture.weekly]))
    expect(reissued.result).toMatchObject({ skipped: [], noop: false })
    expect(reissued.result.paid).toHaveLength(4)
  })

  it('撤值日薪資沖回兩筆並結束效果，同日可重新發放', async () => {
    const { client } = database()
    const { classId, studentIds } = await prepareDuty(client)
    const original = await commitOperation(client, payDuty(classId, payrollDay))
    const receipt = await undoPayroll(client, { classId, original })
    const sorted = [...studentIds].sort()
    expect(receipt.changes.map(({ key }) => key.student_id)).toEqual(sorted)
    expect(receipt.result.transactions).toHaveLength(2)
    for (const [index, root_transaction_id] of original.result.transactions.entries()) {
      expect(await transactionFrom(client, receipt, index)).toMatchObject({
        kind: 'reversal', root_transaction_id, student_id: sorted[index], amount: '-3', earned_delta: '-3',
      })
      expect(receipt.result.effects_reversed[index]).toMatchObject({
        event: 'duty_pay', subject_kind: 'date', subject_key: payrollDay, root_transaction_id, effective_amount: 3,
        rule_id: null, rule_rev: null,
      })
    }
    await expectReversedEffects(client, classId, receipt, original)
    await expectZeroAccounts(client, classId, 2)
    const reissued = await commitOperation(client, payDuty(classId, payrollDay))
    expect(reissued.result.paid.map(({ student_id }) => student_id)).toEqual(sorted)
  })

  it('先單獨沖回一筆，整批撤銷跳過該筆並提示原沖回操作', async () => {
    const { client } = database()
    const fixture = await arrangePayroll(client)
    const { classId, original } = fixture
    const { transaction_id, amount } = original.result.paid[0]
    const manual = await commitOperation(client, reverse(classId, transaction_id, amount))
    const receipt = await undoPayroll(client, fixture)
    const details = {
      effect_id: null, lineage_id: null, transaction_id, changed_by_op_id: manual.op_id, original_amount: amount, amount: null,
    }
    expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'already_reversed', ...details }])
    expect(receipt.result.undo).toMatchObject({ skipped: [details], amount_changed: [] })
    expect(receipt.result.transactions).toHaveLength(3)
    expect(receipt.result.effects_reversed.map((effect) => effect.root_transaction_id)).toEqual(original.result.transactions.slice(1))
    await expectZeroAccounts(client, classId, 3)
  })

  it.each([7, 0])('更正薪資為 %s 後按有效金額沖回並保留沖回前快照', async (changed) => {
    const { client } = database()
    const fixture = await arrangePayroll(client)
    const { classId, original } = fixture
    const { transaction_id, amount } = original.result.paid[0]
    const manual = await commitOperation(client, correct(classId, transaction_id, amount, changed))
    const receipt = await undoPayroll(client, fixture)
    const details = {
      effect_id: null, lineage_id: null, transaction_id, changed_by_op_id: manual.op_id, original_amount: amount, amount: changed,
    }
    expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'amount_changed', ...details }])
    expect(receipt.result.undo).toMatchObject({ skipped: [], amount_changed: [details] })
    expect(receipt.result.transactions).toHaveLength(4)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'reversal', root_transaction_id: transaction_id, amount: String(-changed), earned_delta: String(-changed),
    })
    expect(receipt.result.effects_reversed[0]).toMatchObject({ root_transaction_id: transaction_id, effective_amount: changed })
    await expectReversedEffects(client, classId, receipt, original)
    await expectZeroAccounts(client, classId, 3)
  })

  it('全數先單獨沖回，撤銷不重寫交易但仍只能撤一次', async () => {
    const { client } = database()
    const { classId } = await prepareDuty(client)
    const original = await commitOperation(client, payDuty(classId, payrollDay))
    for (const paid of original.result.paid) {
      await commitOperation(client, reverse(classId, paid.transaction_id, paid.amount))
    }
    const receipt = await expectUndoNoWrite(client, classId, original)
    expect(receipt.result.undo.skipped.map(({ transaction_id }) => transaction_id)).toEqual(original.result.transactions)
    expect(receipt.warnings).toHaveLength(2)
    await rejectUndoWithoutChanges(client, undo(classId, original.op_id), 'ALREADY_UNDONE')
  })

  it.each(['already_paid', 'legacy_period'])('原發薪只有 %s，撤銷成立且不改帳本', async (reason) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const job = await addPayrollJob(client, classId, [studentId])
    const fields = { pay_date: '2026-11-20' }
    if (reason === 'already_paid') await commitOperation(client, runPayroll(classId, [job], fields))
    else await setCutover(client, classId, '2026-11-15')
    const original = await commitOperation(client, runPayroll(classId, [job], fields))
    expect(original.result).toMatchObject({ noop: true, skipped: [{ reason }] })
    const receipt = await expectUndoNoWrite(client, classId, original)
    expect(receipt.result.undo).toMatchObject({ skipped: [], amount_changed: [] })
    expect(receipt.warnings).toEqual([])
  })

  it('學生轉出且職務停用後仍可撤銷值日薪資', async () => {
    const { client } = database()
    const fixture = await prepareDuty(client)
    const { classId, studentId, jobId } = fixture
    const original = await commitOperation(client, payDuty(classId, payrollDay))
    await setEnrollment(client, { classId, studentId }, 'transferred')
    await commitOperation(client, retireJob(classId, jobId))
    const receipt = await undoPayroll(client, { classId, original })
    expect(receipt.result.transactions).toHaveLength(2)
    await expectReversedEffects(client, classId, receipt, original)
    await expectZeroAccounts(client, classId, 2)
  })
})
