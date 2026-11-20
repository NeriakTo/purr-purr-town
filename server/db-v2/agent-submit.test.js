import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, classSequence, operationCount, submit } from './test-support/operations.js'
import { addEventRule, addSubmission, addTask, setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function agentFixture(client, count) {
  const fixture = await addClass(client, { students: Array(count).fill('enrolled') })
  await authorizeAgent(client, fixture.classId)
  await addEventRule(client, fixture.classId)
  const targets = []
  for (const studentId of fixture.studentIds) {
    const taskId = await addTask(client, fixture.classId)
    const target = { ...fixture, studentId, taskId }
    await addSubmission(client, target)
    targets.push(target)
  }
  return { ...fixture, targets }
}

async function classOperations(client, classId) {
  const { rows } = await client.query(`
    SELECT op_id, status, code, batch_id, actor_kind, actor_id
    FROM ppt.operations WHERE class_id = $1 ORDER BY recorded_at, class_seq
  `, [classId])
  return rows
}

async function taskEffects(client, classId) {
  const { rows } = await client.query(`
    SELECT effect_id, student_id, subject_key, root_transaction_id, status, created_op_id
    FROM ppt.effects WHERE class_id = $1 ORDER BY effect_id
  `, [classId])
  return rows
}

async function setupEffectFailure(client, studentId, expected) {
  const state = expected ? 'P604R' : '22012'
  const message = expected ? 'STALE_STATE' : '測試未預期錯誤'
  await client.query(`
    CREATE FUNCTION ppt.fail_batch_effect() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.student_id = TG_ARGV[0] THEN
        IF NOT EXISTS (SELECT 1 FROM ppt.transactions WHERE class_id = NEW.class_id
          AND transaction_id = NEW.root_transaction_id AND kind = 'rule_auto') THEN
          RAISE EXCEPTION '觸發程序必須在扣分寫入後執行';
        END IF;
        RAISE EXCEPTION USING ERRCODE = '${state}', MESSAGE = '${message}';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_batch_effect AFTER INSERT ON ppt.effects
    FOR EACH ROW EXECUTE FUNCTION ppt.fail_batch_effect('${studentId}');
  `)
}

async function removeEffectFailure(client) {
  await client.query('DROP TRIGGER fail_batch_effect ON ppt.effects; DROP FUNCTION ppt.fail_batch_effect()')
}

async function waitForClassLock(observer, waiter, locker) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const { rowCount } = await observer.query(`
      SELECT 1 FROM pg_stat_activity
      WHERE pid = $1 AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))
    `, [waiter.processID, locker.processID])
    if (rowCount === 1) return
    await delay(10)
  }
  throw new Error('未在 pg_stat_activity 觀察到小野等待班級鎖')
}

describeDatabase('小野批次提交', () => {
  const db = useTestDatabase()

  test('老師與小野競爭五十次，每筆繳交只有一個扣分與有效效果', async () => {
    const { client, connect } = db()
    const { classId, studentId } = await agentFixture(client, 1)
    const [left, right] = await Promise.all([connect(), connect()])
    const winners = []
    for (let trial = 0; trial < 50; trial += 1) {
      const taskId = await addTask(client, classId)
      const target = { classId, taskId, studentId }
      await addSubmission(client, target)
      const [teacherReceipt, agentBatch] = await Promise.all([
        submit(left, setStatus(target, 'missing')),
        agentSubmit(right, classId, [setStatus(target, 'missing')]),
      ])
      const [agentReceipt] = agentBatch.receipts
      expect([teacherReceipt.code, agentReceipt.code].sort()).toEqual(['OK', 'STALE_STATE'])
      winners.push([teacherReceipt, agentReceipt].find(receipt => receipt.code === 'OK').op_id)
    }
    const effects = await taskEffects(client, classId)
    expect(effects).toHaveLength(50)
    expect(effects.every(effect => effect.status === 'active')).toBe(true)
    expect(effects.map(effect => effect.created_op_id).sort()).toEqual(winners.sort())
    const { rows } = await client.query(
      "SELECT op_id, amount FROM ppt.transactions WHERE class_id = $1 AND kind = 'rule_auto' ORDER BY op_id",
      [classId],
    )
    expect(rows).toEqual(winners.map(op_id => ({ op_id, amount: '-5' })))
    expect(await classSequence(client, classId)).toBe(50)
    await expect(client.query(`
      INSERT INTO ppt.effects (class_id, effect_id, student_id, event, subject_kind, subject_key,
        root_transaction_id, status, origin, lineage_id)
      SELECT class_id, '重複效果', student_id, event, subject_kind, subject_key,
        root_transaction_id, 'active', 'op', '另一接替鏈'
      FROM ppt.effects WHERE class_id = $1 AND effect_id = $2
    `, [classId, effects[0].effect_id])).rejects.toMatchObject({ code: '23505', constraint: 'effects_one_active_target' })
  }, 15000)

  test('排隊時收回小野授權，鎖內重驗阻擋整批且不留操作', async () => {
    const { client, connect } = db()
    const { classId, targets } = await agentFixture(client, 1)
    const [locker, waiter] = await Promise.all([connect(), connect()])
    const callId = randomUUID()
    const op = setStatus(targets[0], 'missing')
    await locker.query('BEGIN')
    let pending
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [classId])
      pending = Promise.allSettled([agentSubmit(waiter, classId, [op], callId)])
      await waitForClassLock(client, waiter, locker)
      await locker.query('DELETE FROM ppt.class_authorizations WHERE class_id = $1', [classId])
      await locker.query('COMMIT')
    } catch (error) {
      await locker.query('ROLLBACK')
      await pending
      throw error
    }
    expect(await pending).toEqual([
      { status: 'fulfilled', value: { call_id: callId, status: 'retry', code: 'CLASS_FORBIDDEN' } },
    ])
    expect(await classOperations(client, classId)).toEqual([])
    expect(await classSequence(client, classId)).toBe(0)
  }, 15000)

  test('中間版本不符時只保存該筆拒絕，前後成立且重送照原順序', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 3)
    const callId = randomUUID()
    const ops = targets.map((target, index) => setStatus(target, 'missing', { rev: index === 1 ? 42 : 1 }))
    const batch = await agentSubmit(client, classId, ops, callId)
    expect(batch.call_id).toBe(callId)
    expect(batch.receipts.map(receipt => receipt.code)).toEqual(['OK', 'STALE_STATE', 'OK'])
    expect((await classOperations(client, classId)).map(row => [row.op_id, row.batch_id, row.actor_kind, row.actor_id]))
      .toEqual(ops.map(op => [op.op_id, callId, 'agent', 'agent']))
    expect(await submissionRow(client, targets[1])).toMatchObject({ status: 'pending', rev: 1 })
    expect(await classSequence(client, classId)).toBe(2)
    expect(await agentSubmit(client, classId, ops, callId)).toEqual({
      call_id: callId, receipts: batch.receipts.map(receipt => ({ ...receipt, replayed: true })),
    })
    expect(await classSequence(client, classId)).toBe(2)
  })

  test('寫入第二筆扣分與效果後定案拒絕，單筆儲存點回復全部變更', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 3)
    const ops = targets.map(target => setStatus(target, 'missing'))
    await setupEffectFailure(client, targets[1].studentId, true)
    let batch
    try {
      batch = await agentSubmit(client, classId, ops)
    } finally {
      await removeEffectFailure(client)
    }
    expect(batch.receipts.map(receipt => receipt.code)).toEqual(['OK', 'STALE_STATE', 'OK'])
    const states = []
    for (const target of targets) states.push(await submissionRow(client, target))
    expect(states.map(state => [state.status, state.rev, state.last_op_id]))
      .toEqual([['missing', 2, ops[0].op_id], ['pending', 1, null], ['missing', 2, ops[2].op_id]])
    const effects = await taskEffects(client, classId)
    expect(effects.map(effect => effect.created_op_id).sort()).toEqual([ops[0].op_id, ops[2].op_id].sort())
    const { rows } = await client.query('SELECT op_id FROM ppt.transactions WHERE class_id = $1 ORDER BY op_id', [classId])
    expect(rows).toEqual([ops[0].op_id, ops[2].op_id].sort().map(op_id => ({ op_id })))
    expect(await classOperations(client, classId)).toMatchObject([
      { status: 'committed' }, { status: 'rejected', code: 'STALE_STATE' }, { status: 'committed' },
    ])
  })

  test('第三筆未預期錯誤使整批回復，沿用同編號重送可全數成立', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 3)
    const ops = targets.map(target => setStatus(target, 'missing'))
    const callId = randomUUID()
    const snapshot = await classSnapshot(client, classId)
    const count = await operationCount(client)
    await setupEffectFailure(client, targets[2].studentId, false)
    try {
      await expect(agentSubmit(client, classId, ops, callId)).rejects.toMatchObject({ code: '22012' })
    } finally {
      await removeEffectFailure(client)
    }
    expect(await classSnapshot(client, classId)).toBe(snapshot)
    expect(await operationCount(client)).toBe(count)
    const batch = await agentSubmit(client, classId, ops, callId)
    expect(batch.receipts.map(receipt => [receipt.code, receipt.replayed])).toEqual(Array(3).fill(['OK', false]))
  })

  test('小野用過老師的編號回 OP_ID_REUSED，固定身分且新舊批次不互蓋', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 2)
    const original = setStatus(targets[0], 'on_time')
    await submit(client, original)
    const op = { ...setStatus(targets[1], 'missing'), class_id: randomUUID(), batch_id: randomUUID(), actor_kind: 'teacher' }
    const callId = randomUUID()
    const { receipts } = await agentSubmit(client, classId, [original, op], callId)
    expect(receipts[0]).toEqual({ op_id: original.op_id, status: 'retry', code: 'OP_ID_REUSED' })
    expect(receipts[1]).toMatchObject({ code: 'OK' })
    const replay = await agentSubmit(client, classId, [op])
    expect(replay.receipts).toEqual([{ ...receipts[1], replayed: true }])
    expect(await classOperations(client, classId)).toMatchObject([
      { op_id: original.op_id, actor_kind: 'teacher' },
      { op_id: op.op_id, batch_id: callId, actor_kind: 'agent' },
    ])
  })

  test('缺少學生或作業回 SCOPE_FORBIDDEN，已知老師操作回 FORBIDDEN_ROLE', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 1)
    const [target] = targets
    const foreign = await addClass(client)
    const foreignTask = await addTask(client, foreign.classId)
    const { receipts } = await agentSubmit(client, classId, [
      setStatus({ ...target, studentId: foreign.studentId }, 'on_time'),
      setStatus({ ...target, taskId: foreignTask }, 'on_time'),
      adjustment(target),
    ])
    expect(receipts.map(receipt => receipt.code)).toEqual(['SCOPE_FORBIDDEN', 'SCOPE_FORBIDDEN', 'FORBIDDEN_ROLE'])
    expect(receipts.every(receipt => !('current' in receipt))).toBe(true)
  })

  test('空清單、超過五十筆、重複編號和單筆超大一律整批不登記', async () => {
    const { client } = db()
    const { classId, targets } = await agentFixture(client, 1)
    const [target] = targets
    const op = setStatus(target, 'missing')
    const count = await operationCount(client)
    const snapshot = await classSnapshot(client, classId)
    const oversized = { ...op, payload: { ...op.payload, extra: '界'.repeat(22000) } }
    for (const ops of [null, [], [op, op], Array.from({ length: 51 }, () => setStatus(target, 'pending')), [op, oversized], [null]]) {
      const callId = randomUUID()
      expect(await agentSubmit(client, classId, ops, callId))
        .toEqual({ call_id: callId, status: 'retry', code: 'BAD_ENVELOPE' })
    }
    expect(await classSnapshot(client, classId)).toBe(snapshot)
    expect(await operationCount(client)).toBe(count)
    const ops = Array.from({ length: 50 }, () => setStatus(target, 'pending'))
    const batch = await agentSubmit(client, classId, ops)
    expect(batch.receipts.map(receipt => [receipt.code, receipt.result.noop])).toEqual(Array(50).fill(['OK', true]))
  })

  test('小野入口拒絕 repeatable read，缺授權與無此班回同樣結果', async () => {
    const { client, connect } = db()
    const { classId, targets } = await agentFixture(client, 1)
    const [target] = targets
    const worker = await connect()
    const callId = randomUUID()
    const ops = [setStatus(target, 'on_time')]
    await worker.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    try {
      await expect(agentSubmit(worker, classId, ops, callId)).rejects.toMatchObject({ code: '25000' })
    } finally {
      await worker.query('ROLLBACK')
    }
    const unauthorized = await addClass(client)
    const denied = await agentSubmit(client, unauthorized.classId, ops, callId)
    expect(denied).toEqual({ call_id: callId, status: 'retry', code: 'CLASS_FORBIDDEN' })
    expect(await agentSubmit(client, randomUUID(), ops, callId)).toEqual(denied)
    expect(await classOperations(client, classId)).toEqual([])
  })
})
