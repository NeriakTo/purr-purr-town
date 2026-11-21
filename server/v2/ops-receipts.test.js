import { describe, expect, test } from 'vitest'
import { holdMissingSubmissions } from '../db-v2/test-support/agent-held.js'
import { batchUndo, ruleBatch } from '../db-v2/test-support/batch-undo.js'
import { createClass } from '../db-v2/test-support/class-create.js'
import { importedFixture, resolveLegacyEffect } from '../db-v2/test-support/legacy-effects.js'
import { addPayrollJob, payDuty, payrollDay, prepareDuty, runPayroll, setDuty } from '../db-v2/test-support/payroll.js'
import { commitOperation, voidTask } from '../db-v2/test-support/schoolwork.js'
import { setStatus } from '../db-v2/test-support/submissions.js'
import { envelope, readOperation, sendOps, useOpsFixtures } from './test-support/ops.js'

async function grantFixtureOwnership({ client, teacher }, classId) {
  await client.query('UPDATE ppt.class_ownership SET teacher_id = $2 WHERE class_id = $1', [classId, teacher.id])
}

async function expectReceiptAndReplay(context, op) {
  const body = envelope(op.class_id, [op])
  const first = await sendOps(context, body)
  expect(first.statusCode).toBe(200)
  const { receipt } = await readOperation(context.client, op.op_id)
  expect(first.json().receipts).toEqual([receipt])
  const again = await sendOps(context, body)
  expect(again.statusCode).toBe(200)
  expect(again.json().receipts).toEqual([{ ...receipt, replayed: true }])
  expect((await readOperation(context.client, op.op_id)).receipt).toEqual(receipt)
  return { receipt, bytes: first.rawPayload.length }
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('HTTP 收據原樣轉送', () => {
  const fixture = useOpsFixtures()

  test('OP-53 保留 result.legacy_effect', async () => {
    const context = fixture()
    const target = await importedFixture(context.client)
    await grantFixtureOwnership(context, target.classId)
    const { receipt } = await expectReceiptAndReplay(context, resolveLegacyEffect(target, 'none'))
    expect(receipt).toMatchObject({
      status: 'committed', result: { legacy_effect: { effect_id: target.effectId } },
    })
  })

  test('OP-14 保留 current.unresolved_legacy_effects', async () => {
    const context = fixture()
    const target = await importedFixture(context.client)
    await grantFixtureOwnership(context, target.classId)
    const { receipt } = await expectReceiptAndReplay(context, setStatus(target, 'on_time'))
    expect(receipt).toMatchObject({
      code: 'LEGACY_EFFECT_UNRESOLVED', current: { unresolved_legacy_effects: [{ effect_id: target.effectId }] },
    })
  })

  test('OP-12 保留未裁決效果與略過提示', async () => {
    const context = fixture()
    const target = await importedFixture(context.client, { suggested: true })
    await grantFixtureOwnership(context, target.classId)
    const { receipt } = await expectReceiptAndReplay(context, voidTask(target.classId, target.taskId, true))
    expect(receipt).toMatchObject({
      status: 'committed', result: { unresolved_legacy_effects: [{ effect_id: target.effectId }] },
      warnings: [{ code: 'LEGACY_EFFECT_SKIPPED', count: 1 }],
    })
  })

  test('OP-28 保留職務發薪的 paid 與 skipped', async () => {
    const context = fixture()
    const duty = await prepareDuty(context.client)
    const jobId = await addPayrollJob(context.client, duty.classId, [duty.studentId])
    await grantFixtureOwnership(context, duty.classId)
    const { receipt } = await expectReceiptAndReplay(context, runPayroll(duty.classId, [jobId, duty.jobId]))
    expect(receipt).toMatchObject({
      status: 'committed',
      result: { paid: [{ job_id: jobId, student_id: duty.studentId }], skipped: [{ reason: 'duty_job' }] },
    })
  })

  test('OP-30 保留值日發薪的 paid 與 skipped', async () => {
    const context = fixture()
    const { client } = context
    const { classId, studentIds } = await prepareDuty(client, { roster: [0] })
    await commitOperation(client, payDuty(classId, payrollDay))
    await commitOperation(client, setDuty(classId, payrollDay, studentIds, { rev: 1 }))
    await grantFixtureOwnership(context, classId)
    const { receipt } = await expectReceiptAndReplay(context, payDuty(classId, payrollDay))
    expect(receipt).toMatchObject({
      status: 'committed',
      result: { paid: [{ student_id: studentIds[1] }], skipped: [{ student_id: studentIds[0], reason: 'already_paid' }] },
    })
  })

  test('OP-16 保留確認暫緩批次的 result.held', async () => {
    const context = fixture()
    const held = await holdMissingSubmissions(context.client)
    await grantFixtureOwnership(context, held.classId)
    const { receipt } = await expectReceiptAndReplay(context, held.approve())
    expect(receipt).toMatchObject({
      status: 'committed', result: { held: { batch_id: held.batch.call_id, items: expect.any(Array) } },
    })
    expect(receipt.result.held.items).toHaveLength(held.ops.length)
  })

  test('OP-51 保留整批撤銷的 result.batch 與 result.items', async () => {
    const context = fixture()
    const { classId, batch, ops } = await ruleBatch(context.client, 2)
    await grantFixtureOwnership(context, classId)
    const { receipt } = await expectReceiptAndReplay(context, batchUndo(classId, batch.call_id, 2))
    expect(receipt).toMatchObject({
      status: 'committed', result: {
        batch: { batch_id: batch.call_id, op_count: 2 },
        items: ops.toReversed().map(op => ({ target_op_id: op.op_id, outcome: 'undone', undo_op_id: expect.any(String) })),
      },
    })
  })

  test('OP-01 保留 100 位學生建班的完整收據', async () => {
    const context = fixture()
    const op = createClass(100)
    const { receipt, bytes } = await expectReceiptAndReplay(context, op)
    expect(receipt.status).toBe('committed')
    expect(receipt.changes.filter(change => change.entity === 'student')).toHaveLength(100)
    const { rowCount } = await context.client.query('SELECT 1 FROM ppt.students WHERE class_id = $1', [op.class_id])
    expect(rowCount).toBe(100)
    console.info(`T-607 OP-01 建班 100 人 HTTP 回應本文 ${bytes} 位元組`)
  })
})
