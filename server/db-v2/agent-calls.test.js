import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit } from './test-support/agent.js'
import { addAgentClass, addAgentTask, addManualRule, agentApplyRule, agentCallRow } from './test-support/agent-fixtures.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function ruleBatch(client, count = 3) {
  const fixture = await addAgentClass(client, count)
  const ruleId = await addManualRule(client, fixture.classId)
  const ops = fixture.studentIds.map(studentId => agentApplyRule({ ...fixture, studentId }, ruleId))
  return { ...fixture, callId: randomUUID(), ops }
}

async function storedState(client, classId) {
  const { rows } = await client.query(`
    SELECT (SELECT jsonb_agg(o ORDER BY op_id) FROM ppt.operations o WHERE class_id = $1) AS ops,
           (SELECT jsonb_agg(c ORDER BY call_id) FROM ppt.agent_calls c WHERE class_id = $1) AS calls
  `, [classId])
  return { ...rows[0], snapshot: await classSnapshot(client, classId) }
}

function replayed(batch) {
  return { ...batch, receipts: batch.receipts.map(receipt =>
    receipt.status === 'retry' ? receipt : { ...receipt, replayed: true }) }
}

describeDatabase('小野呼叫紀錄與重播', () => {
  const db = useTestDatabase()

  test('三筆套用重送逐筆回原收據，交易、操作、序號與呼叫紀錄不動', async () => {
    const { client } = db()
    const { classId, callId, ops } = await ruleBatch(client)
    const original = await agentSubmit(client, classId, ops, callId)
    expect(original.receipts.map(r => r.code)).toEqual(['OK', 'OK', 'OK'])
    const before = await storedState(client, classId)
    expect(before.calls).toHaveLength(1)
    expect(await agentSubmit(client, classId, ops, callId)).toEqual(replayed(original))
    expect(await storedState(client, classId)).toEqual(before)
  })

  test.each([
    ['改內容', ([a, ...rest]) => [{ ...a, payload: { ...a.payload, rule_version: 2 } }, ...rest]],
    ['少一筆', ops => ops.slice(1)],
    ['多一筆', ops => [...ops, { ...ops[0], op_id: randomUUID() }]],
    ['換順序', ops => [...ops].reverse()],
    ['換編號', ([a, ...rest]) => [{ ...a, op_id: randomUUID() }, ...rest]],
  ])('同呼叫編號%s整次拒收且資料不動', async (_name, alter) => {
    const { client } = db()
    const { classId, callId, ops } = await ruleBatch(client)
    await agentSubmit(client, classId, ops, callId)
    const before = await storedState(client, classId)
    expect(await agentSubmit(client, classId, alter(ops), callId))
      .toEqual({ call_id: callId, status: 'retry', code: 'CALL_ID_REUSED' })
    expect(await storedState(client, classId)).toEqual(before)
  })

  test('跨班沿用呼叫編號只回 CALL_ID_REUSED，兩班資料不動', async () => {
    const { client } = db()
    const original = await ruleBatch(client, 1)
    const other = await ruleBatch(client, 1)
    await agentSubmit(client, original.classId, original.ops, original.callId)
    const before = await Promise.all([original, other].map(f => storedState(client, f.classId)))
    expect(await agentSubmit(client, other.classId, original.ops, original.callId))
      .toEqual({ call_id: original.callId, status: 'retry', code: 'CALL_ID_REUSED' })
    expect(await Promise.all([original, other].map(f => storedState(client, f.classId)))).toEqual(before)
  })

  test('保存首次說明，改說明仍可重播，另一個呼叫可以不帶說明', async () => {
    const { client } = db()
    const { classId, callId, ops } = await ruleBatch(client, 2)
    const original = await agentSubmit(client, classId, ops.slice(0, 1), callId, '界'.repeat(1000))
    expect((await agentCallRow(client, callId)).note).toBe('界'.repeat(1000))
    expect(await agentSubmit(client, classId, ops.slice(0, 1), callId, '更新說明')).toEqual(replayed(original))
    expect((await agentCallRow(client, callId)).note).toBe('界'.repeat(1000))
    const next = await agentSubmit(client, classId, ops.slice(1))
    expect(next.receipts[0].code).toBe('OK')
    expect((await agentCallRow(client, next.call_id)).note).toBeNull()
  })

  test.each(['說明', '整批清單'])('%s超過上限在信封檢查拒收', async kind => {
    const { client } = db()
    const { classId, callId, ops: [op] } = await ruleBatch(client, 1)
    const ops = kind === '說明' ? [op] : Array.from({ length: 9 }, () => ({
      ...op, op_id: randomUUID(), payload: { ...op.payload, extra: '界'.repeat(20000) },
    }))
    const note = kind === '說明' ? '界'.repeat(1001) : null
    expect(await agentSubmit(client, classId, ops, callId, note))
      .toEqual({ call_id: callId, status: 'retry', code: 'BAD_ENVELOPE' })
    expect(await agentCallRow(client, callId)).toBeUndefined()
  })

  test('夾帶既有操作只執行兩筆新操作，全舊呼叫也保存清單', async () => {
    const { client } = db()
    const { classId, callId, ops } = await ruleBatch(client)
    const { receipts: [old] } = await agentSubmit(client, classId, ops.slice(0, 1), callId)
    const mixed = await agentSubmit(client, classId, [ops[1], ops[0], ops[2]])
    expect(mixed.receipts[1]).toEqual({ ...old, replayed: true })
    expect(mixed.receipts.map(r => r.code)).toEqual(['OK', 'OK', 'OK'])
    const { entries } = await agentCallRow(client, mixed.call_id)
    expect(entries).toEqual([ops[1], ops[0], ops[2]].map((op, i) => ({
      op_id: op.op_id, is_new: i !== 1, content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })))
    const before = await storedState(client, classId)
    const batches = new Map(before.ops.map(o => [o.op_id, o.batch_id]))
    expect(ops.map(o => batches.get(o.op_id))).toEqual([callId, mixed.call_id, mixed.call_id])
    const allOld = await agentSubmit(client, classId, ops.slice(0, 2))
    expect(allOld.receipts).toEqual([{ ...old, replayed: true }, { ...mixed.receipts[0], replayed: true }])
    expect((await agentCallRow(client, allOld.call_id)).entries.map(e => e.is_new)).toEqual([false, false])
    expect((await storedState(client, classId)).ops).toEqual(before.ops)
  })

  test('夾帶老師的操作編號重送也只回 OP_ID_REUSED', async () => {
    const { client } = db()
    const { classId, callId, ops } = await ruleBatch(client, 2)
    await commitOperation(client, ops[0])
    const original = await agentSubmit(client, classId, ops, callId)
    expect(original.receipts[0]).toEqual({ op_id: ops[0].op_id, status: 'retry', code: 'OP_ID_REUSED' })
    expect(original.receipts[1].code).toBe('OK')
    expect(await agentSubmit(client, classId, ops, callId)).toEqual(replayed(original))
  })

  test.each(['BAD_ENVELOPE', 'CLASS_FORBIDDEN', 'INVALID_OP_ID', 'CALL_ID_REUSED', '未預期例外'])(
    '%s 不新增呼叫紀錄', async code => {
      const { client } = db()
      const { classId, callId, ops } = await ruleBatch(client)
      if (code === '未預期例外') {
        const fixture = await addAgentClass(client, 3)
        const targets = await addAgentTask(client, fixture, -5)
        const missing = targets.map(target => setStatus(target, 'missing'))
        const before = await storedState(client, fixture.classId)
        await client.query(`
          CREATE FUNCTION ppt.fail_agent_call() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.student_id = TG_ARGV[0] THEN RAISE EXCEPTION '測試未預期錯誤'; END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER fail_agent_call AFTER INSERT ON ppt.effects
          FOR EACH ROW EXECUTE FUNCTION ppt.fail_agent_call('${fixture.studentIds[2]}');
        `)
        try {
          await expect(agentSubmit(client, fixture.classId, missing, callId)).rejects.toMatchObject({ code: 'P0001' })
        } finally {
          await client.query('DROP TRIGGER fail_agent_call ON ppt.effects; DROP FUNCTION ppt.fail_agent_call()')
        }
        expect(await agentCallRow(client, callId)).toBeUndefined()
        expect(await storedState(client, fixture.classId)).toEqual(before)
        expect((await agentSubmit(client, fixture.classId, missing, callId)).receipts.map(r => r.code))
          .toEqual(['OK', 'OK', 'OK'])
        return
      }

      if (code === 'CALL_ID_REUSED') await agentSubmit(client, classId, ops, callId)
      const target = code === 'CLASS_FORBIDDEN' ? (await addClass(client)).classId : classId
      const id = code === 'INVALID_OP_ID' ? '格式錯誤' : callId
      const input = code === 'BAD_ENVELOPE' ? [ops[0], ops[0]] : ops.slice(1)
      const before = await storedState(client, target)
      expect(await agentSubmit(client, target, input, id)).toEqual({ call_id: id, status: 'retry', code })
      expect(await storedState(client, target)).toEqual(before)
    },
  )

  test('老師改過繳交之後，重送仍回原缺交收據且不改回去', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const [target] = await addAgentTask(client, fixture, -5)
    const ops = [setStatus(target, 'missing')]
    const original = await agentSubmit(client, fixture.classId, ops)
    expect(original.receipts[0].code).toBe('OK')
    expect((await submit(client, setStatus(target, 'on_time', { rev: 2 }))).code).toBe('OK')
    const before = await storedState(client, fixture.classId)
    expect(await agentSubmit(client, fixture.classId, ops, original.call_id)).toEqual(replayed(original))
    expect(await storedState(client, fixture.classId)).toEqual(before)
  })

  test('同呼叫兩連線競送十次，每輪恰好一份操作與交易', async () => {
    const { client, connect } = db()
    const [left, right] = await Promise.all([connect(), connect()])
    for (let trial = 0; trial < 10; trial += 1) {
      const { classId, callId, ops } = await ruleBatch(client, 1)
      const results = await Promise.all([left, right].map(c => agentSubmit(c, classId, ops, callId)))
      const [original, replay] = results.sort((a, b) => Number(a.receipts[0].replayed) - Number(b.receipts[0].replayed))
      expect(original.receipts[0]).toMatchObject({ code: 'OK', replayed: false })
      expect(replay).toEqual(replayed(original))
      const { rows: [counts] } = await client.query(`
        SELECT (SELECT count(*)::int FROM ppt.operations WHERE op_id = $1) AS ops,
               (SELECT count(*)::int FROM ppt.transactions WHERE op_id = $1) AS txs
      `, [ops[0].op_id])
      expect(counts).toEqual({ ops: 1, txs: 1 })
      expect((await agentCallRow(client, callId)).entries).toHaveLength(1)
    }
  })
})
