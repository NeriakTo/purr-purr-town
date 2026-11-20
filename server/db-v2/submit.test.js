import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, operationCount, submit } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('提交操作', () => {
  const db = useTestDatabase()

  test('調整點數原子更新交易、帳戶版本與收據，支援負餘額和自學學生', async () => {
    const { client } = db()
    const fixture = await addClass(client, { students: ['home_study'] })
    const op = adjustment(fixture)
    op.payload.reason = '  \t '
    const receipt = await submit(client, op)
    const { rows: [stored] } = await client.query(`
      SELECT o.op_id, o.receipt, o.actor_kind, o.payload,
             t.kind, t.transaction_id, t.amount, t.earned_delta, t.reason,
             t.occurred_at = o.committed_at AND t.effective_at = o.committed_at AS times_match
      FROM ppt.operations AS o JOIN ppt.transactions AS t USING (class_id, op_id)
      WHERE o.op_id = $1
    `, [op.op_id])
    expect(stored).toMatchObject({
      op_id: op.op_id, receipt, actor_kind: 'teacher', payload: op.payload,
      kind: 'adjust', amount: '-5', earned_delta: '-5', reason: '手動調整', times_match: true,
    })
    expect(receipt).toEqual({
      op_id: op.op_id, status: 'committed', code: 'OK', replayed: false,
      class_seq: 1, committed_at: expect.any(String), warnings: [],
      result: { noop: false, transactions: [stored.transaction_id], effects_added: [], effects_reversed: [] },
      changes: [{
        entity: 'account', key: { student_id: fixture.studentId }, prev_rev: 1, rev: 2,
        prev_value: { balance: 0, total_earned: 0 },
        value: { balance: -5, total_earned: -5 }, last_op_id: op.op_id,
      }],
    })
    const { rows: [account] } = await client.query(
      'SELECT rev, last_op_id FROM ppt.accounts WHERE class_id = $1', [fixture.classId],
    )
    expect(account).toEqual({ rev: 2, last_op_id: op.op_id })
  })

  test('定案拒絕只保存含原輸入與雜湊的操作紀錄', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture, 0)
    const before = await classSnapshot(client, fixture.classId)
    const count = await operationCount(client)
    const receipt = await submit(client, op)
    expect(receipt).toEqual({
      op_id: op.op_id, status: 'rejected', code: 'INVALID_PAYLOAD', replayed: false,
      class_seq: null, committed_at: null, warnings: [], changes: [],
      result: { noop: false, transactions: [], effects_added: [], effects_reversed: [] },
    })
    const { rows: [stored] } = await client.query(`
      SELECT payload, type, receipt, octet_length(content_hash) AS hash_bytes,
             status, code, class_seq, committed_at, recorded_at IS NOT NULL AS has_recorded_time
      FROM ppt.operations WHERE op_id = $1
    `, [op.op_id])
    expect(stored).toEqual({
      payload: op.payload, type: op.type, receipt, hash_bytes: 32,
      status: 'rejected', code: 'INVALID_PAYLOAD', class_seq: null, committed_at: null,
      has_recorded_time: true,
    })
    expect(await operationCount(client)).toBe(count + 1)
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test('老師入口拒收小野及尚未支援的系統身分', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const count = await operationCount(client)
    await expect(submit(client, op, { kind: 'agent', id: 'fixture' }))
      .rejects.toMatchObject({ code: '22023' })
    for (const kind of ['system']) {
      await expect(submit(client, op, { kind, id: 'fixture' }))
        .rejects.toMatchObject({ code: '0A000', detail: 'actor_system' })
    }
    expect(await operationCount(client)).toBe(count)
  })
})
