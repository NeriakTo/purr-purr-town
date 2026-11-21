import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit } from './test-support/agent.js'
import {
  addAgentClass, addAgentTask, addManualRule, ageAgentOperation, ageHeldConfirmation,
  agentApplyRule, agentCallRow, appendYesterdayRuleTransaction, setAgentLimits,
} from './test-support/agent-fixtures.js'
import { confirmationsFor, submissionData } from './test-support/confirmations.js'
import { changeRound, createRound, requireRound } from './test-support/correction-rounds.js'
import { classSequence, operationCount } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { reverse } from './test-support/transactions.js'
import { undo } from './test-support/undo.js'

async function missingOps(client, fixture, amount) {
  return (await addAgentTask(client, fixture, amount)).map(target => setStatus(target, 'missing'))
}

async function ruleOps(client, target, amounts) {
  const ops = []
  for (const amount of amounts) {
    ops.push(agentApplyRule(target, await addManualRule(client, target.classId, amount)))
  }
  return ops
}

function checkHeld(batch, ops, reason) {
  expect(batch.receipts).toEqual(ops.map(op => ({
    op_id: op.op_id, status: 'held', code: 'HELD_FOR_TEACHER', replayed: false,
    class_seq: null, committed_at: null, changes: [], warnings: [],
    result: {
      noop: false, transactions: [], effects_added: [], effects_reversed: [],
      confirmation_id: ops[0].op_id, held_reason: reason,
    },
  })))
}

function checkCommitted(batch, count) {
  expect(batch.receipts.map(r => r.code)).toEqual(Array(count).fill('OK'))
}

async function expectHeld(client, classId, ops, reason, callId) {
  const before = await submissionData(client, classId)
  const seq = await classSequence(client, classId)
  const batch = await agentSubmit(client, classId, ops, callId, '測試呼叫說明')
  checkHeld(batch, ops, reason)
  expect(await submissionData(client, classId)).toEqual(before)
  expect(await classSequence(client, classId)).toBe(seq)
  return batch
}

describeDatabase('小野上限與整次暫緩', () => {
  const db = useTestDatabase()

  test('03:388 六位學生缺交全數暫緩，只建立一筆待確認', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 6)
    const { classId } = fixture
    const ops = await missingOps(client, fixture, -5)
    const batch = await expectHeld(client, classId, ops, 'max_students_per_call')
    const call = await agentCallRow(client, batch.call_id)
    expect(call.note).toBe('測試呼叫說明')
    expect(call.entries.every(entry => entry.is_new)).toBe(true)
    expect(await confirmationsFor(client, classId)).toEqual([expect.objectContaining({
      confirmation_id: ops[0].op_id, created_op_id: ops[0].op_id, last_op_id: ops[0].op_id,
      kind: 'agent_held', batch_id: batch.call_id, held_reason: 'max_students_per_call',
      status: 'pending', created_at: call.created_at, task_id: null, student_id: null, proposed_status: null,
    })])
    const { rows } = await client.query(`
      SELECT to_jsonb(o) AS value FROM ppt.operations o WHERE op_id = ANY($1::text[])
    `, [ops.map(op => op.op_id)])
    const records = new Map(rows.map(({ value }) => [value.op_id, value]))
    ops.forEach((op, index) => expect(records.get(op.op_id)).toMatchObject({
      status: 'held', code: 'HELD_FOR_TEACHER', class_seq: null, committed_at: null,
      batch_id: batch.call_id, actor_kind: 'agent', payload: op.payload, expect: op.expect,
      receipt: batch.receipts[index],
    }))
  })

  test('03:388 五筆各 200 點超過單人當日合計，整批試跑回復', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const ops = await ruleOps(client, fixture, Array(5).fill(200))
    await expectHeld(client, fixture.classId, ops, 'max_points_per_student_per_day')
    expect(await confirmationsFor(client, fixture.classId)).toHaveLength(1)
    expect((await submissionData(client, fixture.classId)).transactions).toBeNull()
  })

  test('03:388 六位已暫緩加五位新學生，第二批超過十分鐘上限', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 11)
    const ops = await missingOps(client, fixture, -5)
    await expectHeld(client, fixture.classId, ops.slice(0, 6), 'max_students_per_call')
    await expectHeld(client, fixture.classId, ops.slice(6), 'max_students_per_10min')
    expect(await confirmationsFor(client, fixture.classId)).toHaveLength(2)
    expect((await submissionData(client, fixture.classId)).transactions).toBeNull()
  })

  test.each(['老師今天', '老師今天且已沖回', '小野今天', '已在待確認'])(
    '%s套過同一規則，這次暫緩且沒有新交易', async scenario => {
      const { client } = db()
      const fixture = await addAgentClass(client)
      const { classId } = fixture
      const [op] = await ruleOps(client, fixture, [scenario === '已在待確認' ? 201 : 5])
      if (scenario === '已在待確認') {
        await expectHeld(client, classId, [op], 'max_points_per_tx')
      } else if (scenario === '小野今天') {
        checkCommitted(await agentSubmit(client, classId, [op]), 1)
      } else {
        const receipt = await commitOperation(client, op)
        if (scenario === '老師今天且已沖回') {
          await commitOperation(client, reverse(classId, receipt.result.transactions[0], 5))
        }
      }
      await expectHeld(client, classId, [{ ...op, op_id: randomUUID() }], 'rule_applied_today')
      expect(await confirmationsFor(client, classId)).toHaveLength(scenario === '已在待確認' ? 2 : 1)
    },
  )

  test.each(['不同學生', '不同規則', '只有昨天'])('相同對象條件不成立（%s）可套用', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client, 2)
    const { classId } = fixture
    const [prior, next] = await ruleOps(client, fixture, [5, 5])
    if (scenario === '只有昨天') {
      checkCommitted(await agentSubmit(client, classId, [prior]), 1)
      await appendYesterdayRuleTransaction(client, fixture, prior.op_id, next.payload.rule_id, 5)
    } else {
      await commitOperation(client, prior)
    }
    const op = scenario === '不同學生'
      ? agentApplyRule({ ...fixture, studentId: fixture.studentIds[1] }, prior.payload.rule_id)
      : next
    checkCommitted(await agentSubmit(client, classId, [op]), 1)
  })

  test('03:419 同次兩筆套用同一對象，兩筆全數暫緩', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const [op] = await ruleOps(client, fixture, [5])
    await expectHeld(client, fixture.classId, [op, { ...op, op_id: randomUUID() }], 'duplicate_rule_in_call')
  })

  test.each(['五位學生', '十分鐘十位學生', '單筆 200 點', '當日合計 300 點'])('恰等於上限（%s）仍成立', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client, 10)
    const { classId } = fixture
    if (scenario === '單筆 200 點' || scenario === '當日合計 300 點') {
      const ops = await ruleOps(client, fixture, scenario === '單筆 200 點' ? [200] : [200, 100])
      checkCommitted(await agentSubmit(client, classId, ops), ops.length)
    } else {
      const ops = await missingOps(client, fixture, -5)
      checkCommitted(await agentSubmit(client, classId, ops.slice(0, 5)), 5)
      if (scenario === '十分鐘十位學生') checkCommitted(await agentSubmit(client, classId, ops.slice(5)), 5)
    }
    expect(await confirmationsFor(client, classId)).toEqual([])
  })

  test.each(['手動套用 201 點', '缺交扣 250 點'])('單筆超限（%s）按實際交易整次回復', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const ops = scenario === '手動套用 201 點'
      ? await ruleOps(client, fixture, [201]) : await missingOps(client, fixture, -250)
    await expectHeld(client, fixture.classId, ops, 'max_points_per_tx')
    expect((await submissionData(client, fixture.classId)).transactions).toBeNull()
  })

  test('當日合計含這次，200 加 150 暫緩，改送 100 成立', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [first, excess, enough] = await ruleOps(client, fixture, [200, 150, 100])
    checkCommitted(await agentSubmit(client, classId, [first]), 1)
    await expectHeld(client, classId, [excess], 'max_points_per_student_per_day')
    checkCommitted(await agentSubmit(client, classId, [enough]), 1)
  })

  test.each(['昨天的 300 點', '老師的 300 點', '小野撤銷的沖回'])('當日合計排除%s', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    if (scenario === '小野撤銷的沖回') {
      const [first, last] = await ruleOps(client, fixture, [200, 100])
      checkCommitted(await agentSubmit(client, classId, [first]), 1)
      checkCommitted(await agentSubmit(client, classId, [undo(classId, first.op_id)]), 1)
      checkCommitted(await agentSubmit(client, classId, [last]), 1)
    } else {
      await setAgentLimits(client, classId, { max_points_per_tx: 300 })
      const [prior, last] = await ruleOps(client, fixture, [300, 300])
      if (scenario === '昨天的 300 點') {
        const zero = (await ruleOps(client, fixture, [0]))[0]
        checkCommitted(await agentSubmit(client, classId, [zero]), 1)
        await appendYesterdayRuleTransaction(client, fixture, zero.op_id, prior.payload.rule_id, 300)
      } else {
        await commitOperation(client, prior)
      }
      checkCommitted(await agentSubmit(client, classId, [last]), 1)
    }
  })

  test('暫定做法 100：撤銷不歸還當日額度，200 撤銷後再送 150 仍暫緩', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [first, last] = await ruleOps(client, fixture, [200, 150])
    checkCommitted(await agentSubmit(client, classId, [first]), 1)
    checkCommitted(await agentSubmit(client, classId, [undo(classId, first.op_id)]), 1)
    await expectHeld(client, classId, [last], 'max_points_per_student_per_day')
  })

  test('撤銷的沖回照算單筆上限，超限不寫沖回', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [first] = await ruleOps(client, fixture, [20])
    checkCommitted(await agentSubmit(client, classId, [first]), 1)
    await setAgentLimits(client, classId, { max_points_per_tx: 10 })
    await expectHeld(client, classId, [undo(classId, first.op_id)], 'max_points_per_tx')
  })

  test.each(['成立', '暫緩', '同一人'])('十分鐘視窗按時間與學生去重：%s', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client, 2)
    const { classId } = fixture
    await setAgentLimits(client, classId, { max_students_per_10min: 1 })
    const [a, b] = await missingOps(client, fixture, scenario === '暫緩' ? -201 : -5)
    if (scenario === '暫緩') {
      await expectHeld(client, classId, [a], 'max_points_per_tx')
      await ageHeldConfirmation(client, classId, a.op_id, 11)
      const fresh = await addAgentTask(client, fixture)
      checkCommitted(await agentSubmit(client, classId, [setStatus(fresh[1], 'on_time')]), 1)
    } else {
      checkCommitted(await agentSubmit(client, classId, [a]), 1)
      if (scenario === '成立') await ageAgentOperation(client, a.op_id, 11)
      const next = scenario === '同一人'
        ? { ...a, op_id: randomUUID(), payload: { ...a.payload, status: 'makeup' }, expect: { rev: 2 } }
        : b
      checkCommitted(await agentSubmit(client, classId, [next]), 1)
    }
  })

  test.each(['OP-18', 'OP-19', 'OP-50', '同一學生'])('以%s的學生計算每批人數', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client, 2)
    const { classId } = fixture
    const targets = await addAgentTask(client, fixture)
    await setAgentLimits(client, classId, { max_students_per_call: 1 })
    let ops
    if (scenario === 'OP-19') {
      const rounds = await Promise.all(targets.map(target => createRound(client, target)))
      ops = rounds.map(round => changeRound(round, 'mark_returned', { rev: 1 }))
    } else if (scenario === 'OP-50') {
      const original = targets.map(target => setStatus(target, 'missing'))
      for (const op of original) checkCommitted(await agentSubmit(client, classId, [op]), 1)
      ops = original.map(op => undo(classId, op.op_id))
    } else if (scenario === '同一學生') {
      ops = [requireRound(targets[0]), setStatus(targets[0], 'missing')]
    } else {
      ops = targets.map(target => requireRound(target))
    }
    if (scenario === '同一學生') checkCommitted(await agentSubmit(client, classId, ops), 2)
    else await expectHeld(client, classId, ops, 'max_students_per_call')
  })

  test('OP-43 可調每批人數為二，三位暫緩、兩位成立', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 5)
    const { classId } = fixture
    await setAgentLimits(client, classId, { max_students_per_call: 2.0 })
    const ops = await missingOps(client, fixture, -5)
    await expectHeld(client, classId, ops.slice(0, 3), 'max_students_per_call')
    checkCommitted(await agentSubmit(client, classId, ops.slice(3)), 2)
  })

  test('03:418 新操作暫緩時既有操作仍回原收據，批次成員只有新操作', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 7)
    const { classId } = fixture
    const [oldOp, ...newOps] = await missingOps(client, fixture, -5)
    const old = await agentSubmit(client, classId, [oldOp])
    checkCommitted(old, 1)
    const batch = await agentSubmit(client, classId, [oldOp, ...newOps])
    expect(batch.receipts[0]).toEqual({ ...old.receipts[0], replayed: true })
    checkHeld({ receipts: batch.receipts.slice(1) }, newOps, 'max_students_per_call')
    expect((await agentCallRow(client, batch.call_id)).entries.map(e => e.is_new)).toEqual([
      false, true, true, true, true, true, true,
    ])
  })

  test('試跑的版本拒絕也回復，和超過金額的操作一併暫緩', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const [target] = await addAgentTask(client, fixture)
    const [expensive] = await ruleOps(client, fixture, [201])
    await expectHeld(client, classId, [expensive, setStatus(target, 'missing', { rev: 42 })], 'max_points_per_tx')
  })

  test.each(['暫緩', '成立'])('同呼叫重送保留%s結果、略過最新上限', async scenario => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    const ops = await ruleOps(client, fixture, [scenario === '暫緩' ? 201 : 5])
    const original = await agentSubmit(client, classId, ops)
    expect(original.receipts[0].status).toBe(scenario === '暫緩' ? 'held' : 'committed')
    const before = await confirmationsFor(client, classId)
    expect(await agentSubmit(client, classId, ops, original.call_id)).toEqual({
      ...original, receipts: original.receipts.map(receipt => ({ ...receipt, replayed: true })),
    })
    expect(await confirmationsFor(client, classId)).toEqual(before)
    expect(before).toHaveLength(scenario === '暫緩' ? 1 : 0)
  })

  test('待確認佇列達到兩批只擋需暫緩的呼叫，整次不留紀錄', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const { classId } = fixture
    await setAgentLimits(client, classId, { max_pending_held: 2 })
    const [first, second, third, allowed] = await ruleOps(client, fixture, [201, 201, 201, 5])
    for (const op of [first, second]) await expectHeld(client, classId, [op], 'max_points_per_tx')
    const count = await operationCount(client)
    const before = await submissionData(client, classId)
    const callId = randomUUID()
    expect(await agentSubmit(client, classId, [third], callId)).toEqual({
      call_id: callId, status: 'retry', code: 'HELD_QUEUE_FULL',
    })
    expect(await agentCallRow(client, callId)).toBeUndefined()
    expect(await operationCount(client)).toBe(count)
    expect(await submissionData(client, classId)).toEqual(before)
    expect(await confirmationsFor(client, classId)).toHaveLength(2)
    checkCommitted(await agentSubmit(client, classId, [allowed]), 1)
  })
})
