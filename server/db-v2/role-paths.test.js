import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  addAgentClass, addAgentTask, addManualRule, agentApplyRule, agentCallRow, setAgentLimits,
} from './test-support/agent-fixtures.js'
import { batchUndo } from './test-support/batch-undo.js'
import { batchUndoId, uuidV5 } from './test-support/batch-uuid.js'
import { classSnapshot } from './test-support/checks.js'
import { commitClass, createClass } from './test-support/class-create.js'
import {
  applyComment, commentRow, generatedComment, requestComment, saveComment, system,
} from './test-support/comments.js'
import { confirm, confirmationsFor, submissionData } from './test-support/confirmations.js'
import { correctionRow, overdueEvent } from './test-support/correction-rounds.js'
import { addClass, adjustment, cancel, classSequence, operationCount, submit } from './test-support/operations.js'
import { agentSubmitAs, connectAsRole } from './test-support/roles.js'
import { offsetDay, overdueFixture, overdueOperation, scheduler } from './test-support/scheduler.js'
import { commitOperation } from './test-support/schoolwork.js'
import { balanceOf, saveEventRule } from './test-support/submission-flow.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const emptyResult = { noop: false, transactions: [], effects_added: [], effects_reversed: [] }

async function connectWeb(database) {
  return connectAsRole(database, 'ppt_web')
}

async function connectAgent(database) {
  return connectAsRole(database, 'ppt_agent')
}

function assertCommitted(receipt, op, sequence, result, changes) {
  expect(receipt).toEqual({
    op_id: op.op_id, status: 'committed', code: 'OK', replayed: false,
    class_seq: sequence, committed_at: expect.any(String),
    result, changes, warnings: [],
  })
}

async function missingOperations(client, fixture) {
  const targets = await addAgentTask(client, fixture, -5)
  return targets.map(target => setStatus(target, 'missing'))
}

async function ruleOperations(client, fixture, amounts) {
  const ops = []
  for (const amount of amounts) {
    const ruleId = await addManualRule(client, fixture.classId, amount)
    ops.push(agentApplyRule(fixture, ruleId))
  }
  return ops
}

async function expectHeld(client, agent, classId, ops, reason) {
  const before = await submissionData(client, classId)
  const prior = await confirmationsFor(client, classId)
  const seq = await classSequence(client, classId)
  const confirmationId = ops[0].op_id
  const batch = await agentSubmitAs(agent, classId, ops)
  expect(batch).toEqual({
    call_id: expect.any(String),
    receipts: ops.map(op => ({
      op_id: op.op_id, status: 'held', code: 'HELD_FOR_TEACHER', replayed: false,
      class_seq: null, committed_at: null, changes: [], warnings: [],
      result: { ...emptyResult, confirmation_id: confirmationId, held_reason: reason },
    })),
  })
  expect(await submissionData(client, classId)).toEqual(before)
  expect(await classSequence(client, classId)).toBe(seq)
  const confirmations = await confirmationsFor(client, classId)
  expect(confirmations).toHaveLength(prior.length + 1)
  expect(confirmations.find(item => item.confirmation_id === confirmationId)).toMatchObject({
    kind: 'agent_held', status: 'pending', batch_id: batch.call_id, held_reason: reason,
  })
  return batch
}

async function processHeldBatch(web, classId, batch, action, codes) {
  const confirmationId = batch.receipts[0].op_id
  const prior = (await confirmationsFor(web, classId)).find(item => item.confirmation_id === confirmationId)
  expect(prior).toMatchObject({ kind: 'agent_held', status: 'pending', batch_id: batch.call_id })

  const op = confirm(classId, confirmationId, 'confirmation.' + action)
  const sequence = await classSequence(web, classId)
  const receipt = await submit(web, op)
  const status = action === 'confirm' ? 'confirmed' : 'rejected'
  const items = batch.receipts.map(({ op_id }, index) => ({
    op_id, code: codes[index], status: codes[index] === 'OK' ? 'committed' : 'rejected',
  }))
  const committedMembers = codes.filter(code => code === 'OK').length
  assertCommitted(receipt, op, sequence + committedMembers + 1, {
    ...emptyResult, held: { batch_id: batch.call_id, items },
  }, [expect.objectContaining({
    entity: 'confirmation', rev: 2,
    value: { status, processed_op_id: op.op_id, processed_at: receipt.committed_at },
  })])
  const stored = (await confirmationsFor(web, classId)).find(item => item.confirmation_id === confirmationId)
  expect(stored).toMatchObject({
    status, rev: 2, processed_op_id: op.op_id, processed_at: new Date(receipt.committed_at),
  })
}

async function prepareCallStudentLimit(client) {
  const fixture = await addAgentClass(client, 6)
  const ops = await missingOperations(client, fixture)
  return { classId: fixture.classId, ops }
}

async function prepareWindowStudentLimit(client, agent) {
  const fixture = await addAgentClass(client, 11)
  const { classId } = fixture
  const ops = await missingOperations(client, fixture)
  await expectHeld(client, agent, classId, ops.slice(0, 6), 'max_students_per_call')
  return { classId, ops: ops.slice(6) }
}

async function prepareRuleAppliedToday(client) {
  const fixture = await addAgentClass(client)
  const [prior] = await ruleOperations(client, fixture, [5])
  await commitOperation(client, prior)
  return { classId: fixture.classId, ops: [{ ...prior, op_id: randomUUID() }] }
}

async function prepareDuplicateRule(client) {
  const fixture = await addAgentClass(client)
  const [op] = await ruleOperations(client, fixture, [5])
  return { classId: fixture.classId, ops: [op, { ...op, op_id: randomUUID() }] }
}

async function prepareTransactionLimit(client) {
  const fixture = await addAgentClass(client)
  const ops = await ruleOperations(client, fixture, [201])
  return { classId: fixture.classId, ops }
}

async function prepareDailyPointsLimit(client) {
  const fixture = await addAgentClass(client)
  const ops = await ruleOperations(client, fixture, [200, 200, 200, 200, 200])
  return { classId: fixture.classId, ops }
}

async function waitForClassLock(observer, waiter, locker) {
  await expect.poll(async () => {
    const { rowCount } = await observer.query(`
      SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE pid = $1 AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))
    `, [waiter.processID, locker.processID])
    return rowCount
  }, { timeout: 5000, message: '小野連線應等候鎖班級的連線' }).toBe(1)
}

describeDatabase('網站與小野的資料庫角色通路', () => {
  const db = useTestDatabase()

  test('網站以老師身分送 OP-24，交易、帳戶與收據一致', async () => {
    const fixture = await addClass(db().client)
    const web = await connectWeb(db())
    const op = adjustment(fixture)
    const receipt = await submit(web, op)
    const { rows: [stored] } = await web.query(`
      SELECT o.receipt, o.actor_kind, t.transaction_id, t.amount
      FROM ppt.operations o JOIN ppt.transactions t USING (class_id, op_id)
      WHERE o.op_id = $1
    `, [op.op_id])
    expect(stored).toMatchObject({ receipt, actor_kind: 'teacher', amount: '-5' })
    assertCommitted(receipt, op, 1, { ...emptyResult, transactions: [stored.transaction_id] }, [{
      entity: 'account', key: { student_id: fixture.studentId }, prev_rev: 1, rev: 2,
      prev_value: { balance: 0, total_earned: 0 }, value: { balance: -5, total_earned: -5 },
      last_op_id: op.op_id,
    }])
  })

  test('網站放棄新的操作編號，重送取回原收據', async () => {
    const { classId } = await addClass(db().client)
    const web = await connectWeb(db())
    const opId = randomUUID()
    const receipt = await cancel(web, classId, opId)
    expect(receipt).toEqual({
      op_id: opId, status: 'cancelled', code: 'OP_CANCELLED', replayed: false,
      class_seq: null, committed_at: null, changes: [], warnings: [], result: emptyResult,
    })
    expect(await cancel(web, classId, opId)).toEqual({ ...receipt, replayed: true })
  })

  test('網站以老師身分送 OP-01，建立班級、學生與帳戶', async () => {
    const web = await connectWeb(db())
    const { receipt, op, classId, studentId } = await commitClass(web, createClass(1))
    assertCommitted(receipt, op, 1, {
      ...emptyResult, class: { class_id: classId, student_count: 1, inherited_from: null },
    }, expect.any(Array))
    expect(receipt.changes.map(change => change.entity)).toEqual([
      'class', 'student', 'account', ...Array(4).fill('setting'), ...Array(6).fill('rule'),
      ...Array(3).fill('job'), ...Array(6).fill('product'), 'seating',
    ])
    const { rows } = await web.query(
      'SELECT name FROM ppt.students WHERE class_id = $1 AND student_id = $2', [classId, studentId],
    )
    expect(rows).toEqual([{ name: '1號村民' }])
    expect(await balanceOf(web, { classId, studentId })).toBe(0)
  })

  test('網站以老師身分送 OP-17，退回小野暫緩批次', async () => {
    const { client } = db()
    const [web, agent] = await Promise.all([connectWeb(db()), connectAgent(db())])
    const { classId, ops } = await prepareCallStudentLimit(client)
    const batch = await expectHeld(client, agent, classId, ops, 'max_students_per_call')
    const before = await submissionData(client, classId)
    await processHeldBatch(web, classId, batch, 'reject', ops.map(() => 'CONFIRMATION_REJECTED'))
    expect(await submissionData(client, classId)).toEqual(before)
  })

  test('網站以老師身分送 OP-51，整批撤銷小野成立的交易', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [target] = await ruleOperations(client, fixture, [5])
    const [web, agent] = await Promise.all([connectWeb(db()), connectAgent(db())])
    const batch = await agentSubmitAs(agent, classId, [target])
    expect(batch.receipts).toMatchObject([{ op_id: target.op_id, status: 'committed', code: 'OK' }])
    const sequence = await classSequence(web, classId)
    const op = batchUndo(classId, batch.call_id)
    const receipt = await submit(web, op)
    assertCommitted(receipt, op, sequence + 2, {
      ...emptyResult, batch: { batch_id: batch.call_id, op_count: 1 },
      items: [{ target_op_id: target.op_id, outcome: 'undone', undo_op_id: batchUndoId(op.op_id, target.op_id) }],
    }, [])
    expect(await balanceOf(web, fixture)).toBe(0)
  })

  test('網站以排程身分送 OP-52，逾期訂正寫入扣分', async () => {
    const { client } = db()
    const { target, classId, today } = await overdueFixture(client)
    await saveEventRule(client, classId, overdueEvent, -6)
    const web = await connectWeb(db())
    const sequence = await classSequence(web, classId)
    const date = offsetDay(today, -8)
    const op = overdueOperation(classId, date)
    const receipt = await submit(web, op, scheduler)
    const transactionId = receipt.result.transactions[0]
    expect(transactionId).toEqual(expect.any(String))
    assertCommitted(receipt, op, sequence + 1, {
      ...emptyResult, transactions: [transactionId], effects_added: [expect.objectContaining({
        event: overdueEvent, subject_kind: 'correction', subject_key: target.correctionId,
        root_transaction_id: transactionId, amount: -6,
      })],
    }, [expect.objectContaining({
      entity: 'correction', key: { correction_id: target.correctionId },
      prev_rev: 1, rev: 2, prev_value: { overdue_on: null }, value: { overdue_on: date },
    }), expect.objectContaining({ entity: 'account', key: { student_id: target.studentId } })])
    expect(await correctionRow(web, target)).toMatchObject({ overdue_on: date, last_op_id: op.op_id })
    expect(await balanceOf(web, target)).toBe(-6)
  })

  test('網站以老師身分送 OP-46，再以系統身分送 OP-47 套用評語', async () => {
    const fixture = await addClass(db().client)
    const web = await connectWeb(db())
    await commitOperation(web, saveComment(fixture, { observation: '測試觀察' }))
    const request = requestComment(fixture, { rev: 1 })
    const accepted = await submit(web, request)
    assertCommitted(accepted, request, 2, emptyResult, [expect.objectContaining({
      entity: 'comment', rev: 2, value: { generation_status: 'generating' },
    })])
    const op = applyComment(fixture, request.op_id)
    const receipt = await submit(web, op, system)
    const value = { ...generatedComment, generation_status: 'idle' }
    assertCommitted(receipt, op, 3, {
      ...emptyResult, superseded: false, written: ['comment', 'motto'],
    }, [expect.objectContaining({ entity: 'comment', prev_rev: 2, rev: 3, value })])
    expect(await commentRow(web, fixture)).toMatchObject(value)
  })

  test('網站以系統身分送 v5 的 OP-24，禁止執行且只留下拒絕紀錄', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const before = await classSnapshot(client, fixture.classId)
    const web = await connectWeb(db())
    const count = await operationCount(web)
    const op = { ...adjustment(fixture), op_id: uuidV5(fixture.classId, '系統 OP-24') }
    const receipt = await submit(web, op, system)
    expect(receipt).toEqual({
      op_id: op.op_id, status: 'rejected', code: 'FORBIDDEN_ROLE', replayed: false,
      class_seq: null, committed_at: null, changes: [], warnings: [], result: emptyResult,
    })
    const { rows } = await web.query(
      'SELECT actor_kind, actor_id, status, code, receipt FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    expect(rows).toEqual([{ actor_kind: 'system', actor_id: 'system', status: 'rejected', code: 'FORBIDDEN_ROLE', receipt }])
    expect(await operationCount(web)).toBe(count + 1)
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test.each([
    ['max_students_per_call', prepareCallStudentLimit],
    ['max_students_per_10min', prepareWindowStudentLimit],
    ['rule_applied_today', prepareRuleAppliedToday],
    ['duplicate_rule_in_call', prepareDuplicateRule],
    ['max_points_per_tx', prepareTransactionLimit],
    ['max_points_per_student_per_day', prepareDailyPointsLimit],
  ])('小野經入口遇到 %s 暫緩，網站讀取後以 OP-16 確認', async (reason, prepare) => {
    const { client } = db()
    const [web, agent] = await Promise.all([connectWeb(db()), connectAgent(db())])
    const { classId, ops } = await prepare(client, agent)
    const batch = await expectHeld(client, agent, classId, ops, reason)
    const codes = ops.map(() => 'OK')
    if (reason === 'duplicate_rule_in_call') codes[1] = 'HELD_OP_OUTDATED'
    await processHeldBatch(web, classId, batch, 'confirm', codes)
  })

  test('小野經入口遇到佇列已滿，整次不留紀錄，網站仍能確認既有批次', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    await setAgentLimits(client, classId, { max_pending_held: 2 })
    const [first, second, third, allowed] = await ruleOperations(client, fixture, [201, 201, 201, 5])
    const [web, agent] = await Promise.all([connectWeb(db()), connectAgent(db())])
    const batch = await expectHeld(client, agent, classId, [first], 'max_points_per_tx')
    await expectHeld(client, agent, classId, [second], 'max_points_per_tx')

    const before = await classSnapshot(client, classId)
    const count = await operationCount(web)
    const callId = randomUUID()
    expect(await agentSubmitAs(agent, classId, [third], callId)).toEqual({
      call_id: callId, status: 'retry', code: 'HELD_QUEUE_FULL',
    })
    expect(await agentCallRow(web, callId)).toBeUndefined()
    expect(await operationCount(web)).toBe(count)
    expect(await classSnapshot(client, classId)).toBe(before)
    const accepted = await agentSubmitAs(agent, classId, [allowed])
    expect(accepted.receipts).toMatchObject([{ op_id: allowed.op_id, status: 'committed', code: 'OK' }])
    await processHeldBatch(web, classId, batch, 'confirm', ['OK'])
  })

  test('03:421 小野等候班級鎖時被撤回授權，不留紀錄也不消耗序號', async () => {
    const { client, connect } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const ops = await missingOperations(client, fixture)
    const [locker, agent] = await Promise.all([connect(), connectAgent(db())])
    const callId = randomUUID()
    const count = await operationCount(client)
    const seq = await classSequence(client, classId)
    let pending
    await locker.query('BEGIN')
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [classId])
      pending = Promise.allSettled([agentSubmitAs(agent, classId, ops, callId)])
      await waitForClassLock(client, agent, locker)
      const removed = await locker.query(
        "DELETE FROM ppt.class_authorizations WHERE class_id = $1 AND actor_kind = 'agent'", [classId],
      )
      expect(removed.rowCount).toBe(1)
      await locker.query('COMMIT')
    } catch (error) {
      await locker.query('ROLLBACK')
      await pending
      throw error
    }
    expect(await pending).toEqual([{
      status: 'fulfilled', value: { call_id: callId, status: 'retry', code: 'CLASS_FORBIDDEN' },
    }])
    expect(await agentCallRow(client, callId)).toBeUndefined()
    expect(await operationCount(client)).toBe(count)
    expect(await classSequence(client, classId)).toBe(seq)
  }, 15000)
})
