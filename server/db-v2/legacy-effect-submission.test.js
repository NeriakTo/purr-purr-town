import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addImportedSubmission, importedDeduction, importedFixture, readEffect } from './test-support/legacy-effects.js'
import { classSequence, operationCount, submit } from './test-support/operations.js'
import { commitOperation, createTask, operation } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { undo } from './test-support/undo.js'

const dailyWarning = { code: 'LEGACY_DAY_NO_DAILY_QUEST', date: '2026-09-02' }

describeDatabase('未裁決歷史效果與繳交', () => {
  const db = useTestDatabase()

  test('三種匯入效果形狀可寫入既有效果表', async () => {
    const { client } = db()
    const linked = await importedFixture(client, { linked: true })
    const unresolved = await importedFixture(client)
    const suggested = await importedFixture(client, { suggested: true })
    for (const target of [linked, unresolved, suggested]) {
      const effect = await readEffect(client, target)
      expect(effect.effect_id).toMatch(/^[0-9a-f]{64}$/)
      expect(target.taskId).toMatch(/^[0-9a-f]{64}$/)
      if (target.transactionId) expect(target.transactionId).toMatch(/^[0-9a-f]{64}$/)
      expect(effect).toMatchObject({
        lineage_id: effect.effect_id, student_id: target.studentId, subject_kind: 'task',
        subject_key: target.taskId, origin: 'legacy', rule_id: null, rule_rev: null,
        created_op_id: null, reversed_op_id: null,
      })
    }
    expect(await readEffect(client, linked)).toMatchObject({
      status: 'active', event: 'submission.missing', root_transaction_id: linked.transactionId,
      suggested_transaction_id: null,
    })
    expect(await readEffect(client, unresolved)).toMatchObject({
      status: 'legacy_unresolved', event: null, root_transaction_id: null, suggested_transaction_id: null,
    })
    expect(await readEffect(client, suggested)).toMatchObject({
      status: 'legacy_unresolved', event: null, root_transaction_id: null,
      suggested_transaction_id: suggested.transactionId,
    })
  })

  test('改準時保存拒絕並重播，資料與班級序號不變', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    const op = setStatus(target, 'on_time')
    const before = await classSnapshot(client, target.classId)
    const seq = await classSequence(client, target.classId)
    const count = await operationCount(client)
    const receipt = await submit(client, op)
    expect(receipt).toMatchObject({ code: 'LEGACY_EFFECT_UNRESOLVED', status: 'rejected', class_seq: null })
    expect(receipt.current).toEqual({ unresolved_legacy_effects: [{ effect_id: target.effectId }] })
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    expect(await classSequence(client, target.classId)).toBe(seq)
    expect(await operationCount(client)).toBe(count + 1)
  })

  test.each([
    ['missing', 'pending'], ['missing', 'late'], ['missing', 'leave'], ['missing', 'exempt'],
    ['late', 'missing'], ['makeup', 'missing'],
  ])('%s 改 %s 被擋', async (from, to) => {
    const { client } = db()
    const target = await importedFixture(client, { status: from })
    expect((await submit(client, setStatus(target, to))).code).toBe('LEGACY_EFFECT_UNRESOLVED')
  })

  test.each([false, true])('候選存在為 %s 時允許補交並保留交易與歷史效果', async (suggested) => {
    const { client } = db()
    const target = await importedFixture(client, { suggested })
    const before = await readEffect(client, target)
    if (suggested) {
      const receipt = await submit(client, setStatus(target, 'on_time'))
      expect(receipt.current).toEqual({ unresolved_legacy_effects: [{ effect_id: target.effectId }] })
    }
    const receipt = await commitOperation(client, setStatus(target, 'makeup'))
    expect(receipt.result.transactions).toEqual([])
    expect(receipt.warnings).toEqual([{ ...dailyWarning, student_id: target.studentId }])
    expect(await submissionRow(client, target)).toMatchObject({ status: 'makeup', rev: 2, basis_rev: 2 })
    expect(await readEffect(client, target)).toEqual(before)
    expect(await importedDeduction(client, target)).toEqual({ balance: suggested ? -6 : 0, count: suggested ? 1 : 0 })
  })

  test('小野只能改補交，拒絕只帶效果編號', async () => {
    const { client } = db()
    const target = await importedFixture(client, { suggested: true })
    await authorizeAgent(client, target.classId)
    const blocked = setStatus(target, 'on_time')
    const makeup = setStatus(target, 'makeup')
    const { receipts } = await agentSubmit(client, target.classId, [blocked, makeup])
    expect(receipts.map(receipt => receipt.code)).toEqual(['LEGACY_EFFECT_UNRESOLVED', 'OK'])
    expect(receipts[0].current).toEqual({ unresolved_legacy_effects: [{ effect_id: target.effectId }] })
    const { rows } = await client.query('SELECT actor_kind FROM ppt.operations WHERE op_id = $1', [makeup.op_id])
    expect(rows).toEqual([{ actor_kind: 'agent' }])
    expect(await submissionRow(client, target)).toMatchObject({ status: 'makeup', rev: 2, basis_rev: 2 })
  })

  test('同值成立且繳交原樣保留', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    const before = await submissionRow(client, target)
    const receipt = await commitOperation(client, setStatus(target, 'missing'))
    expect(receipt.result.noop).toBe(true)
    expect(await submissionRow(client, target)).toEqual(before)
  })

  test('版本不符優先，匯入繳交沒有最後操作者', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    const receipt = await submit(client, setStatus(target, 'on_time', { rev: 2 }))
    expect(receipt).toMatchObject({
      code: 'STALE_STATE', current: { rev: 1, last_op_id: null, actor: null, committed_at: null },
    })
  })

  test('同學生其他作業及同作業其他學生不受影響', async () => {
    const { client } = db()
    const target = await importedFixture(client, { students: ['enrolled', 'enrolled'] })
    const otherStudent = { ...target, studentId: target.studentIds[1] }
    await addImportedSubmission(client, otherStudent, 'pending')
    const fresh = createTask(target.classId)
    await commitOperation(client, fresh)
    await commitOperation(client, setStatus({ ...target, taskId: fresh.payload.task_id }, 'on_time'))
    await commitOperation(client, setStatus(otherStudent, 'on_time'))
  })

  test('裁決前可撤銷補交，回到原基準且仍擋改準時', async () => {
    const { client } = db()
    const target = await importedFixture(client)
    const makeup = await commitOperation(client, setStatus(target, 'makeup'))
    await commitOperation(client, undo(target.classId, makeup.op_id))
    expect(await submissionRow(client, target)).toMatchObject({ status: 'missing', rev: 3, basis_rev: 1 })
    expect((await readEffect(client, target)).status).toBe('legacy_unresolved')
    expect(await importedDeduction(client, target)).toEqual({ balance: 0, count: 0 })
    expect((await submit(client, setStatus(target, 'on_time', { rev: 3 }))).code).toBe('LEGACY_EFFECT_UNRESOLVED')
  })

  test('已否決的歷史效果不擋改準時', async () => {
    const { client } = db()
    const target = await importedFixture(client, { dismissed: true })
    const receipt = await commitOperation(client, setStatus(target, 'on_time'))
    expect(receipt.result.transactions).toEqual([])
  })

  test('不一致的待收繳交仍不能確認提議', async () => {
    const { client } = db()
    const target = await importedFixture(client, { status: 'pending' })
    const proposal = await commitOperation(client, operation(target.classId, 'submission.propose', {
      task_id: target.taskId, student_id: target.studentId, proposed_status: 'missing',
    }))
    const receipt = await submit(client, operation(target.classId, 'confirmation.confirm', {
      confirmation_id: proposal.op_id,
    }))
    expect(receipt.code).toBe('LEGACY_EFFECT_UNRESOLVED')
    expect(await submissionRow(client, target)).toMatchObject({ status: 'pending', rev: 1, basis_rev: 1 })
    const { rows } = await client.query('SELECT status FROM ppt.confirmations WHERE confirmation_id = $1', [proposal.op_id])
    expect(rows).toEqual([{ status: 'pending' }])
  })
})
