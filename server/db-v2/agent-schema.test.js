import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit } from './test-support/agent.js'
import {
  addAgentClass, addAgentTask, addManualRule, ageAgentOperation, ageHeldConfirmation,
  agentApplyRule, agentCallRow, appendYesterdayRuleTransaction,
} from './test-support/agent-fixtures.js'
import { assertAccountTotals, classSnapshot } from './test-support/checks.js'
import { commitOperation, operation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function insertCall(client, classId, callId, entries = '[]') {
  await client.query(`
    INSERT INTO ppt.agent_calls (class_id, call_id, entries, created_at)
    VALUES ($1, $2, $3, clock_timestamp())
  `, [classId, callId, entries])
}

describeDatabase('小野呼叫資料表與測試支架', () => {
  const db = useTestDatabase()

  test('呼叫編號全庫唯一、清單須為陣列且說明可空', async () => {
    const { client } = db()
    const { classId } = await addAgentClass(client)
    const other = await addAgentClass(client)
    const callId = randomUUID()
    await insertCall(client, classId, callId)
    expect(await agentCallRow(client, callId)).toMatchObject({ entries: [], note: null })
    await expect(insertCall(client, other.classId, callId)).rejects.toMatchObject({ code: '23505' })
    await expect(insertCall(client, classId, randomUUID(), '{}')).rejects.toMatchObject({ code: '23514' })
  })

  test('五個新結果碼是操作結果列舉的成員', async () => {
    const { client } = db()
    const codes = ['HELD_FOR_TEACHER', 'CONFIRMATION_REJECTED', 'HELD_OP_OUTDATED', 'CALL_ID_REUSED', 'HELD_QUEUE_FULL']
    const { rows: [{ values }] } = await client.query('SELECT $1::ppt.operation_code[]::text[] AS values', [codes])
    expect(values).toEqual(codes)
  })

  test('班級快照略過呼叫紀錄，仍包含待確認項目', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const [{ taskId, studentId }] = await addAgentTask(client, fixture)
    const proposal = operation(fixture.classId, 'submission.propose', {
      task_id: taskId, student_id: studentId, proposed_status: 'on_time',
    })
    await commitOperation(client, proposal)
    const before = await classSnapshot(client, fixture.classId)
    await insertCall(client, fixture.classId, randomUUID())
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
    await ageHeldConfirmation(client, fixture.classId, proposal.op_id, 11)
    expect(await classSnapshot(client, fixture.classId)).not.toBe(before)
  })

  test('操作時間可前推，補昨天的交易仍維持帳戶與存摺相等', async () => {
    const { client } = db()
    const target = await addAgentClass(client)
    const ruleId = await addManualRule(client, target.classId)
    const op = agentApplyRule(target, ruleId)
    const { receipts: [receipt] } = await agentSubmit(client, target.classId, [op])
    expect(receipt.code).toBe('OK')
    const { rows: [before] } = await client.query(
      'SELECT recorded_at, committed_at FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    await ageAgentOperation(client, op.op_id, 11)
    const { rows: [after] } = await client.query(
      'SELECT recorded_at, committed_at FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    for (const key of ['recorded_at', 'committed_at']) expect(before[key] - after[key]).toBe(11 * 60 * 1000)
    await appendYesterdayRuleTransaction(client, target, op.op_id, ruleId, 7)
    const { rows: [yesterday] } = await client.query(`
      SELECT amount FROM ppt.transactions
      WHERE op_id = $1 AND (occurred_at AT TIME ZONE 'Asia/Taipei')::date
        = (clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date - 1
    `, [op.op_id])
    expect(yesterday).toEqual({ amount: '7' })
    await assertAccountTotals(client)
  })
})
