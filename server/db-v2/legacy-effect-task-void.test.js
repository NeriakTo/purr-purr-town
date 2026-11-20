import { expect, test } from 'vitest'
import {
  addImportedDeduction, addImportedEffect, addImportedSubmission, importedDeduction, importedFixture,
  readEffect, resolveLegacyEffect,
} from './test-support/legacy-effects.js'
import { commitOperation, voidTask } from './test-support/schoolwork.js'
import { saveEventRule } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function taskWithMixedEffects(client) {
  const linked = await importedFixture(client, { linked: true, students: Array(3).fill('enrolled') })
  const unresolved = { ...linked, studentId: linked.studentIds[1] }
  const current = { ...linked, studentId: linked.studentIds[2] }
  await addImportedSubmission(client, unresolved, 'missing')
  unresolved.transactionId = await addImportedDeduction(client, unresolved, { amount: -8 })
  unresolved.effectId = await addImportedEffect(client, unresolved, { suggested: unresolved.transactionId })
  await addImportedSubmission(client, current, 'pending')
  await saveEventRule(client, current.classId, 'submission.missing', -9)
  const marked = await commitOperation(client, setStatus(current, 'missing'))
  current.effectId = marked.result.effects_added[0].effect_id
  current.transactionId = marked.result.transactions[0]
  return [linked, unresolved, current]
}

async function readMixedState(client, targets) {
  const states = []
  for (const target of targets) {
    states.push({
      effect: await readEffect(client, target),
      ledger: await importedDeduction(client, target),
      submission: await submissionRow(client, target),
    })
  }
  return states
}

describeDatabase('OP-12 作廢與歷史效果', () => {
  const db = useTestDatabase()

  test('選沖回同時退舊扣分與新版扣分，列出未裁決且保留繳交版本', async () => {
    const { client } = db()
    const targets = await taskWithMixedEffects(client)
    const [linked, unresolved, current] = targets
    const { classId, taskId } = linked
    const before = await readMixedState(client, targets)
    const receipt = await commitOperation(client, voidTask(classId, taskId, true))
    const after = await readMixedState(client, targets)
    const { rows } = await client.query('SELECT voided FROM ppt.tasks WHERE class_id = $1 AND task_id = $2', [classId, taskId])
    expect(rows).toEqual([{ voided: true }])
    expect(receipt.changes.map(change => [change.entity, change.key])).toEqual([
      ['task', { task_id: taskId }],
      ...[linked.studentId, current.studentId].sort().map(studentId => ['account', { student_id: studentId }]),
    ])
    expect(receipt.result.transactions).toHaveLength(2)
    const { rows: reversals } = await client.query(`
      SELECT kind, amount::int, root_transaction_id FROM ppt.transactions WHERE class_id = $1 AND op_id = $2
      ORDER BY amount
    `, [classId, receipt.op_id])
    expect(reversals).toEqual([
      { kind: 'reversal', amount: 6, root_transaction_id: linked.transactionId },
      { kind: 'reversal', amount: 9, root_transaction_id: current.transactionId },
    ])
    expect(after[0].effect).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
    expect(after[2].effect).toMatchObject({ status: 'reversed', reversed_op_id: receipt.op_id })
    expect(after[1]).toEqual(before[1])
    expect(after.map(state => state.ledger.balance)).toEqual([0, -8, 0])
    expect(after.map(state => state.submission)).toEqual(before.map(state => state.submission))
    expect(receipt.result.unresolved_legacy_effects).toEqual([{
      effect_id: unresolved.effectId, student_id: unresolved.studentId, subject_kind: 'task', subject_key: taskId,
    }])
    expect(receipt.warnings).toEqual([{ code: 'LEGACY_EFFECT_SKIPPED', count: 1 }])
  })

  test('不選沖回時保留所有效果及餘額，省略清單與提示', async () => {
    const { client } = db()
    const targets = await taskWithMixedEffects(client)
    const [{ classId, taskId }] = targets
    const before = await readMixedState(client, targets)
    const receipt = await commitOperation(client, voidTask(classId, taskId, false))
    expect(receipt.changes[0].value).toEqual({ voided: true })
    expect(receipt.result).not.toHaveProperty('unresolved_legacy_effects')
    expect(receipt.warnings).toEqual([])
    expect(await readMixedState(client, targets)).toEqual(before)
  })

  test('選沖回且全數已對應時回空清單', async () => {
    const { client } = db()
    const target = await importedFixture(client, { linked: true })
    const receipt = await commitOperation(client, voidTask(target.classId, target.taskId, true))
    expect(receipt.result.unresolved_legacy_effects).toEqual([])
    expect(receipt.warnings).toEqual([])
  })

  test('已作廢再選沖回仍為同值，省略清單且點數不動', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    await commitOperation(client, voidTask(target.classId, target.taskId, false))
    const before = await readMixedState(client, [target])
    const receipt = await commitOperation(client, voidTask(target.classId, target.taskId, true, 2))
    expect(receipt.result.noop).toBe(true)
    expect(receipt.result).not.toHaveProperty('unresolved_legacy_effects')
    expect(receipt.warnings).toEqual([])
    expect(await readMixedState(client, [target])).toEqual(before)
  })

  test('裁決為未扣分的效果不列入作廢清單', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    await commitOperation(client, resolveLegacyEffect(target, 'none'))
    const receipt = await commitOperation(client, voidTask(target.classId, target.taskId, true))
    expect(receipt.result.unresolved_legacy_effects).toEqual([])
    expect(receipt.warnings).toEqual([])
    expect((await readEffect(client, target)).status).toBe('dismissed')
  })
})
