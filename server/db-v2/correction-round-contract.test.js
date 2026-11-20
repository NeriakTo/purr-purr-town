import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  changeRound, confirmedEvent, correctionRow, createRound, expectCorrectionState, requireRound,
  returnRound, setupCorrectionTask,
} from './test-support/correction-rounds.js'
import { adjustment, classSequence, operationCount, submit, teacher } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { effectRow } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

const roundActions = [
  ['OP-19', 'mark_returned', {}],
  ['OP-20', 'confirm', {}],
  ['OP-21', 'redo', { next_correction_id: randomUUID() }],
  ['OP-22', 'cancel', { reverse_effects: false }],
  ['OP-23', 'set_due', { due_on: null }],
]

async function assertReadOnlyConflict(client, op) {
  await client.query('BEGIN READ ONLY')
  try {
    await expect(client.query('SELECT ppt.check_undo_operation($1::jsonb, $2::jsonb)', [op, teacher]))
      .rejects.toMatchObject({ code: 'P604R', message: 'UNDO_CONFLICT' })
  } finally {
    await client.query('ROLLBACK')
  }
}

async function assertNoReversal(client, classId, rootId) {
  const { rows } = await client.query(`
    SELECT transaction_id FROM ppt.transactions
    WHERE class_id = $1 AND kind = 'reversal' AND root_transaction_id = $2
  `, [classId, rootId])
  expect(rows).toEqual([])
}

async function assertOnlyRejectionAdded(client, op, count, sequence) {
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, op.class_id)).toBe(sequence)
  const { rows } = await client.query(
    'SELECT status, code, class_seq FROM ppt.operations WHERE class_id = $1 AND op_id = $2',
    [op.class_id, op.op_id],
  )
  expect(rows).toEqual([{ status: 'rejected', code: 'UNDO_CONFLICT', class_seq: null }])
}

describeDatabase('訂正甲段驗收', () => {
  const database = useTestDatabase()

  test('S6 與 16.3 第 5 條逐步驗收，第一輪確認受阻時保留獎勵且可用新編號重撤', async () => {
    const { client } = database()
    const target = await setupCorrectionTask(client)
    const { classId } = target
    const startingBalance = 23
    const reward = 7
    await commitOperation(client, adjustment(target, startingBalance))
    await saveEventRule(client, classId, confirmedEvent, reward)
    const first = await createRound(client, target)
    const nextOp = requireRound(target)
    const second = { ...target, correctionId: nextOp.payload.correction_id }
    const rewarded = startingBalance + reward

    await returnRound(client, first)
    await expectCorrectionState(client, first, 2, 2, 'returned', startingBalance)
    expect(await correctionRow(client, second)).toBeUndefined()

    const confirmed = await commitOperation(client, changeRound(first, 'confirm', { rev: 2 }))
    const [rootId] = confirmed.result.transactions
    const [{ effect_id: effectId }] = confirmed.result.effects_added
    await expectCorrectionState(client, first, 3, 3, 'confirmed', rewarded, [[confirmedEvent, reward]])
    expect(await correctionRow(client, second)).toBeUndefined()

    await commitOperation(client, nextOp)
    await expectCorrectionState(client, first, 3, 3, 'confirmed', rewarded, [[confirmedEvent, reward]])
    await expectCorrectionState(client, second, 1, 1, 'required', rewarded)

    const blocked = undo(classId, confirmed.op_id)
    const count = await operationCount(client)
    const sequence = await classSequence(client, classId)
    await assertReadOnlyConflict(client, blocked)
    const rejected = await rejectUndoWithoutChanges(client, blocked, 'UNDO_CONFLICT')
    expect(rejected.current).toMatchObject({ reason: 'open_round_exists', correction_id: second.correctionId })
    await assertOnlyRejectionAdded(client, blocked, count, sequence)
    await assertNoReversal(client, classId, rootId)
    await expectCorrectionState(client, first, 3, 3, 'confirmed', rewarded, [[confirmedEvent, reward]])
    await expectCorrectionState(client, second, 1, 1, 'required', rewarded)

    await commitOperation(client, undo(classId, nextOp.op_id))
    await expectCorrectionState(client, first, 3, 3, 'confirmed', rewarded, [[confirmedEvent, reward]])
    await expectCorrectionState(client, second, 2, 0, 'cancelled', rewarded)

    const retry = undo(classId, confirmed.op_id)
    expect(retry.op_id).not.toBe(blocked.op_id)
    const undone = await commitOperation(client, retry)
    await expectCorrectionState(client, first, 4, 2, 'returned', startingBalance)
    await expectCorrectionState(client, second, 2, 0, 'cancelled', startingBalance)
    expect(await effectRow(client, classId, effectId)).toMatchObject({
      status: 'reversed', reversed_op_id: undone.op_id,
    })
    expect(undone.result.effects_reversed).toMatchObject([{ root_transaction_id: rootId, effective_amount: reward }])
  })

  test('03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號', async () => {
    const { client } = database()
    const first = await createRound(client, await setupCorrectionTask(client))
    const second = await createRound(client, await setupCorrectionTask(client))
    const before = await classSnapshot(client, second.classId)
    for (const [, action, fields] of roundActions) {
      const op = changeRound({ ...first, correctionId: second.correctionId }, action, { rev: 1 }, fields)
      const receipt = await rejectUndoWithoutChanges(client, op, 'NOT_FOUND')
      expect(receipt).not.toHaveProperty('current')
      expect(await classSnapshot(client, second.classId)).toBe(before)
    }
    await returnRound(client, first)
    const next = changeRound(first, 'redo', { rev: 2 }, { next_correction_id: second.correctionId })
    await commitOperation(client, next)
    expect(await correctionRow(client, { ...first, correctionId: second.correctionId })).toMatchObject({
      status: 'required', round: 2,
    })
    expect(await classSnapshot(client, second.classId)).toBe(before)
  })

  test.each([['OP-18', null, {}], ...roundActions])('%s 驗收共通拒絕與 expect 契約', async (_id, action, fields) => {
    const { client } = database()
    const target = await createRound(client, await setupCorrectionTask(client))
    const newOp = (version) => action ? changeRound(target, action, version, fields) : requireRound(target)
    const valid = newOp(action ? { rev: 1 } : undefined)
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [target.classId])
    await rejectUndoWithoutChanges(client, valid, 'CLASS_ARCHIVED')
    const active = await createRound(client, await setupCorrectionTask(client))
    const extra = action ? changeRound(active, action, { rev: 1 }, fields) : requireRound(active)
    extra.payload.unknown_key = true
    await rejectUndoWithoutChanges(client, extra, 'INVALID_PAYLOAD')
    if (!action) {
      const op = { ...requireRound(active), expect: { rev: 1 } }
      await rejectUndoWithoutChanges(client, op, 'INVALID_PAYLOAD')
      return
    }
    for (const version of [undefined, null, { rev: 1, after_op: active.created.op_id }]) {
      await rejectUndoWithoutChanges(client, changeRound(active, action, version, fields), 'INVALID_PAYLOAD')
    }
  })

  test('兩條連線並行建立二十次，每份作業只有一輪成立', async () => {
    const { client, connect } = database()
    const peer = await connect()
    const target = await setupCorrectionTask(client)
    for (let attempt = 0; attempt < 20; attempt++) {
      const task = await assignTask(client, target)
      const first = requireRound(task)
      const second = requireRound(task)
      const results = await Promise.all([submit(client, first), submit(peer, second)])
      expect(results.map(({ code }) => code).sort()).toEqual(['INVALID_TRANSITION', 'OK'])
      const winner = results.find(({ code }) => code === 'OK')
      const { rows } = await client.query(`
        SELECT correction_id, rev, basis_rev, round, status FROM ppt.corrections
        WHERE class_id = $1 AND task_id = $2 AND student_id = $3
      `, [task.classId, task.taskId, task.studentId])
      expect(rows).toEqual([{
        correction_id: winner.changes[0].key.correction_id, rev: 1, basis_rev: 1, round: 1, status: 'required',
      }])
    }
  })
})
