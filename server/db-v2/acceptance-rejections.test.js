import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  addClass, adjustment, cancel, classSequence, operationCount, submit,
} from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function assertRecordedRejection(client, fixture, op, code) {
  const before = await classSnapshot(client, fixture.classId)
  const count = await operationCount(client)
  const seq = await classSequence(client, fixture.classId)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({
    op_id: op.op_id, status: 'rejected', code, class_seq: null, replayed: false,
  })
  const { rows } = await client.query(
    'SELECT status, code, receipt FROM ppt.operations WHERE op_id = $1', [op.op_id],
  )
  expect(rows).toEqual([{ status: 'rejected', code, receipt }])
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSequence(client, fixture.classId)).toBe(seq)
  expect(await classSnapshot(client, fixture.classId)).toBe(before)

  expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSnapshot(client, fixture.classId)).toBe(before)
  return receipt
}

async function installFailureTrigger(client, triggerBody) {
  await client.query(`
    CREATE FUNCTION ppt.test_fail_after_ledger_insert() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, ppt, pg_temp AS $$
    BEGIN
      IF NEW.reason = '驗收觸發拒絕' THEN
        ${triggerBody}
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER test_fail_after_ledger_insert
    AFTER INSERT ON ppt.transactions FOR EACH ROW EXECUTE FUNCTION ppt.test_fail_after_ledger_insert();
  `)
}

async function dropFailureTrigger(client) {
  await client.query(`
    DROP TRIGGER test_fail_after_ledger_insert ON ppt.transactions;
    DROP FUNCTION ppt.test_fail_after_ledger_insert();
  `)
}

const rejectionCases = [
  ['金額為零', 'INVALID_PAYLOAD', {}, { payload: { amount: 0 } }],
  ['金額非整數', 'INVALID_PAYLOAD', {}, { payload: { amount: -0.5 } }],
  ['金額超過上限', 'INVALID_PAYLOAD', {}, { payload: { amount: -100001 } }],
  ['理由超過一百字', 'INVALID_PAYLOAD', {}, { payload: { reason: '測'.repeat(101) } }],
  ['累加型帶版本條件', 'INVALID_PAYLOAD', {}, { expect: { rev: 1 } }],
  ['累加型帶 JSON null 的版本條件', 'INVALID_PAYLOAD', {}, { expect: null }],
  ['學生屬於另一班', 'NOT_FOUND', { otherClass: true }, {}],
  ['學生轉出', 'ENTITY_INACTIVE', { students: ['transferred'] }, {}],
  ['班級封存', 'CLASS_ARCHIVED', { status: 'archived' }, { payload: { amount: 0 } }],
  ['種類未知', 'UNKNOWN_OP_TYPE', { status: 'archived' }, { type: 'fixture.unknown' }],
]

describeDatabase('拒絕與原子性驗收', () => {
  const db = useTestDatabase()

  test.each(rejectionCases)('%s 的定案拒絕只留一列並可重播', async (_label, code, fixtureOptions, overrides) => {
    const { client } = db()
    const fixture = await addClass(client, fixtureOptions)
    const other = fixtureOptions.otherClass ? await addClass(client) : fixture
    const base = adjustment(fixture)
    const op = {
      ...base, ...overrides,
      payload: { ...base.payload, ...overrides.payload, student_id: other.studentId },
    }
    const otherBefore = fixtureOptions.otherClass ? await classSnapshot(client, other.classId) : null
    await assertRecordedRejection(client, fixture, op, code)
    if (otherBefore !== null) expect(await classSnapshot(client, other.classId)).toBe(otherBefore)
  })

  test('資料已寫入後丟出定案例外仍完整回復，並保存 current', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    op.payload.reason = '驗收觸發拒絕'
    await installFailureTrigger(client, `
      IF NOT EXISTS (
        SELECT 1 FROM transactions WHERE class_id = NEW.class_id AND transaction_id = NEW.transaction_id
      ) THEN
        RAISE EXCEPTION '測試前提不符，拒絕前必須已有交易列';
      END IF;
      PERFORM reject_operation('STALE_STATE', '{"value":{"balance":0,"total_earned":0},"rev":1,"actor":null,"committed_at":null}');
    `)
    try {
      const receipt = await assertRecordedRejection(client, fixture, op, 'STALE_STATE')
      expect(receipt.current).toEqual({
        value: { balance: 0, total_earned: 0 }, rev: 1, actor: null, committed_at: null,
      })
    } finally {
      await dropFailureTrigger(client)
    }
  })

  test('未預期例外回復操作紀錄與所有資料，同編號可再成立', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    op.payload.reason = '驗收觸發拒絕'
    const before = await classSnapshot(client, fixture.classId)
    const count = await operationCount(client)
    await installFailureTrigger(client, "RAISE EXCEPTION USING ERRCODE = '22012', MESSAGE = '驗收未預期錯誤';")
    try {
      await expect(submit(client, op)).rejects.toMatchObject({ code: '22012' })
      expect(await classSnapshot(client, fixture.classId)).toBe(before)
      expect(await operationCount(client)).toBe(count)
    } finally {
      await dropFailureTrigger(client)
    }
    expect(await submit(client, op)).toMatchObject({ status: 'committed', code: 'OK', replayed: false, class_seq: 1 })
  })

  test('不是擁有者與班級不存在的回應逐位元相同且無紀錄', async () => {
    const { client } = db()
    const fixture = await addClass(client, { owner: { kind: 'teacher', id: 'other-teacher-fixture' } })
    const op = adjustment(fixture)
    const before = await classSnapshot(client, fixture.classId)
    const count = await operationCount(client)
    const forbidden = await submit(client, op)
    const missing = await submit(client, { ...op, class_id: 'missing-class' })
    expect(forbidden).toEqual({ op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' })
    expect(Buffer.from(JSON.stringify(forbidden))).toEqual(Buffer.from(JSON.stringify(missing)))
    expect(await operationCount(client)).toBe(count)
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test('老師提交與放棄皆拒收第 5 版編號且未登記', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    op.op_id = op.op_id.slice(0, 14) + '5' + op.op_id.slice(15)
    const before = await classSnapshot(client, fixture.classId)
    const count = await operationCount(client)
    const expected = { op_id: op.op_id, status: 'retry', code: 'INVALID_OP_ID' }
    expect(await submit(client, op)).toEqual(expected)
    expect(await cancel(client, fixture.classId, op.op_id)).toEqual(expected)
    expect(await operationCount(client)).toBe(count)
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test('信封、班級存取、編號格式按順序檢查且皆不保存', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const count = await operationCount(client)
    expect(await submit(client, [])).toEqual({ op_id: null, status: 'retry', code: 'BAD_ENVELOPE' })
    expect(await submit(client, { ...op, class_id: undefined })).toEqual({
      op_id: op.op_id, status: 'retry', code: 'BAD_ENVELOPE',
    })
    expect(await submit(client, {
      ...op, class_id: 'missing-class', op_id: 'bad-id', payload: { reason: '村'.repeat(22000) },
    })).toEqual({ op_id: 'bad-id', status: 'retry', code: 'BAD_ENVELOPE' })
    expect(await submit(client, { ...op, class_id: 'missing-class', op_id: 'bad-id' })).toEqual({
      op_id: 'bad-id', status: 'retry', code: 'CLASS_FORBIDDEN',
    })
    expect(await submit(client, { ...op, op_id: 'bad-id' })).toEqual({
      op_id: 'bad-id', status: 'retry', code: 'INVALID_OP_ID',
    })
    expect(await operationCount(client)).toBe(count)
  })
})
