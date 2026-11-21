import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  addImportedDeduction, importedFixture, readEffect, resolveLegacyEffect,
} from './test-support/legacy-effects.js'
import { adjustment, classSequence, operationCount, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { balanceOf, saveEventRule } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { undo } from './test-support/undo.js'

const late = 'submission.late'
const missing = 'submission.missing'

async function activeTaskEffects(client, { classId, studentId, taskId }) {
  const { rows } = await client.query(`
    SELECT e.effect_id, e.event, e.root_transaction_id, ppt.effective_transaction_amount(t)::int AS amount
    FROM ppt.effects e JOIN ppt.transactions t
      ON t.class_id = e.class_id AND t.transaction_id = e.root_transaction_id
    WHERE e.class_id = $1 AND e.student_id = $2 AND e.subject_kind = 'task' AND e.subject_key = $3
      AND e.status = 'active'
  `, [classId, studentId, taskId])
  return rows
}

async function checkS5State(client, target, { rev, status, balance, oldStatus, originalAmount, active }) {
  expect(await submissionRow(client, target)).toMatchObject({ rev, basis_rev: rev, assignment_active: true, status })
  expect((await readEffect(client, target)).status).toBe(oldStatus)
  expect(await balanceOf(client, target)).toBe(balance)
  expect(await activeTaskEffects(client, target)).toEqual(active)
  const { rows } = await client.query(`
    SELECT ppt.effective_transaction_amount(t)::int AS amount
    FROM ppt.transactions t WHERE class_id = $1 AND transaction_id = $2
  `, [target.classId, target.transactionId])
  expect(rows).toEqual([{ amount: originalAmount }])
}

describeDatabase('歷史效果資料庫驗收', () => {
  const db = useTestDatabase()

  test('S5 補交後裁決會擋撤銷，改缺交退舊分並扣現行金額', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    target.transactionId = await addImportedDeduction(client, target, { reason: '作業遲交', amount: -6 })
    await saveEventRule(client, target.classId, missing, -9)
    await commitOperation(client, adjustment(target, 20))
    const start = {
      rev: 1, status: 'missing', balance: 14, oldStatus: 'legacy_unresolved', originalAmount: -6, active: [],
    }
    await checkS5State(client, target, start)

    const makeup = await commitOperation(client, setStatus(target, 'makeup', { rev: 1 }))
    expect(makeup.warnings).toEqual([{
      code: 'LEGACY_DAY_NO_DAILY_QUEST', student_id: target.studentId, date: '2026-09-02',
    }])
    expect(makeup.result.transactions).toEqual([])
    await checkS5State(client, target, { ...start, rev: 2, status: 'makeup' })

    const resolution = await commitOperation(client, resolveLegacyEffect(target, 'link', {
      transaction_id: target.transactionId, event: late,
    }, { rev: 2 }))
    const resolved = {
      ...start, rev: 3, status: 'makeup', oldStatus: 'active',
      active: [{ effect_id: target.effectId, event: late, root_transaction_id: target.transactionId, amount: -6 }],
    }
    await checkS5State(client, target, resolved)

    const before = await classSnapshot(client, target.classId)
    const count = await operationCount(client)
    const op = undo(target.classId, makeup.op_id)
    const rejected = await submit(client, op)
    expect(rejected).toMatchObject({
      code: 'UNDO_CONFLICT', status: 'rejected', class_seq: null,
      current: { reason: 'basis_changed', rev: 3, basis_rev: 3, last_op_id: resolution.op_id },
    })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    expect(await operationCount(client)).toBe(count + 1)
    const { rows } = await client.query('SELECT status FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(rows).toEqual([{ status: 'rejected' }])
    await checkS5State(client, target, resolved)

    const marked = await commitOperation(client, setStatus(target, 'missing', { rev: 3 }))
    expect(marked.result.transactions).toHaveLength(2)
    const { effects_added: [added], effects_reversed: [reversed] } = marked.result
    expect(reversed).toMatchObject({ effect_id: target.effectId, root_transaction_id: target.transactionId, effective_amount: -6 })
    await checkS5State(client, target, {
      rev: 4, status: 'missing', balance: 11, oldStatus: 'reversed', originalAmount: 0,
      active: [{ effect_id: added.effect_id, event: missing, root_transaction_id: added.root_transaction_id, amount: -9 }],
    })
  })

  test('同一老師的兩個班也不能互相引用效果或交易', async () => {
    const { client } = db()
    const first = await importedFixture(client)
    const second = await importedFixture(client, { suggested: true })
    const beforeFirst = await classSnapshot(client, first.classId)
    const beforeSecond = await classSnapshot(client, second.classId)
    const foreign = resolveLegacyEffect({ ...first, effectId: second.effectId }, 'none')
    const linked = resolveLegacyEffect(first, 'link', { transaction_id: second.transactionId })
    for (const op of [foreign, linked]) {
      const receipt = await submit(client, op)
      expect(receipt).toMatchObject({ status: 'rejected', code: 'NOT_FOUND', class_seq: null })
      expect(receipt).not.toHaveProperty('current')
    }
    expect(await classSnapshot(client, first.classId)).toBe(beforeFirst)
    expect(await classSnapshot(client, second.classId)).toBe(beforeSecond)
  })

  test('兩連線競送十次，各只成立一次並只推進一次版本', async () => {
    const { client, connect } = db()
    const [left, right] = await Promise.all([connect(), connect()])
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const target = await importedFixture(client, { suggested: true })
      const link = resolveLegacyEffect(target, 'link', { transaction_id: target.transactionId })
      const none = resolveLegacyEffect(target, 'none')
      const receipts = await Promise.all([submit(left, link), submit(right, none)])
      expect(receipts.map(receipt => receipt.code).sort()).toEqual(['INVALID_TRANSITION', 'OK'])
      const winner = receipts.find(receipt => receipt.code === 'OK')
      const loser = receipts.find(receipt => receipt.code === 'INVALID_TRANSITION')
      expect(winner).toMatchObject({ status: 'committed', class_seq: 1 })
      expect(loser).toMatchObject({ status: 'rejected', class_seq: null })
      expect(await submissionRow(client, target)).toMatchObject({ rev: 2, basis_rev: 2, last_op_id: winner.op_id })
      expect((await readEffect(client, target)).status).toBe(winner.result.legacy_effect.status)
      expect(await classSequence(client, target.classId)).toBe(1)
    }
  })
})
