import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, classSequence, operationCount, submit } from './test-support/operations.js'
import { commitOperation, createTask, restoreTask, saveRule, updateTask, voidTask } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function missingTask(client, number = 2) {
  const fixture = await addClass(client, { students: Array(number).fill('enrolled') })
  const { classId, studentIds } = fixture
  const create = createTask(classId)
  await commitOperation(client, create)
  const taskId = create.payload.task_id
  const rule = saveRule(classId, { kind: 'event', event: 'submission.missing', amount: -5 })
  await commitOperation(client, rule)
  const statuses = new Map()
  for (const studentId of studentIds) {
    statuses.set(studentId, await commitOperation(client, setStatus({ classId, taskId, studentId }, 'missing')))
  }
  return { ...fixture, taskId, statuses, ruleId: rule.payload.rule_id }
}

async function taskLedger(client, classId) {
  const { rows: accounts } = await client.query(`
    SELECT student_id, balance::int, total_earned::int FROM ppt.accounts WHERE class_id = $1 ORDER BY student_id COLLATE "C"
  `, [classId])
  const { rows: effects } = await client.query(`
    SELECT student_id, event, status, reversed_op_id FROM ppt.effects WHERE class_id = $1 ORDER BY student_id COLLATE "C"
  `, [classId])
  return { accounts, effects }
}

async function reversals(client, opId) {
  const { rows } = await client.query(`
    SELECT student_id, amount::int, earned_delta::int, kind, root_transaction_id
    FROM ppt.transactions WHERE op_id = $1 ORDER BY student_id COLLATE "C"
  `, [opId])
  return rows
}

async function installSecondReversalRejection(client) {
  await client.query(`
    CREATE FUNCTION ppt.test_reject_second_reversal() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, ppt, pg_temp AS $$
    BEGIN
      IF NEW.kind = 'reversal' AND EXISTS (
        SELECT 1 FROM transactions WHERE class_id = NEW.class_id AND op_id = NEW.op_id
          AND kind = 'reversal' AND student_id <> NEW.student_id
      ) THEN
        PERFORM reject_operation('INVALID_PAYLOAD');
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER test_reject_second_reversal
    AFTER INSERT ON ppt.transactions FOR EACH ROW EXECUTE FUNCTION ppt.test_reject_second_reversal();
  `)
}

describeDatabase('OP-12 與 OP-13', () => {
  const database = useTestDatabase()

  test('依學生編號沖回兩筆缺交，包括轉出與封存學生，繳交版本不動', async () => {
    const { client } = database()
    const { classId, taskId, studentIds, statuses, ruleId } = await missingTask(client)
    await client.query(`
      UPDATE ppt.students SET enrollment_status = CASE student_id WHEN $2 THEN 'transferred' ELSE 'archived' END
      WHERE class_id = $1
    `, [classId, studentIds[0]])
    const before = await Promise.all(studentIds.map(studentId => submissionRow(client, { classId, taskId, studentId })))
    const op = voidTask(classId, taskId, true)
    const receipt = await commitOperation(client, op)
    const sorted = [...studentIds].sort()
    expect(receipt.changes).toMatchObject([
      { entity: 'task', key: { task_id: taskId }, prev_rev: 1, rev: 2, prev_value: { voided: false }, value: { voided: true } },
      ...sorted.map(studentId => ({
        entity: 'account', key: { student_id: studentId }, prev_value: { balance: -5 }, value: { balance: 0 },
      })),
    ])
    expect(receipt.result).toMatchObject({
      effects_added: [],
      effects_reversed: sorted.map(studentId => {
        const original = statuses.get(studentId)
        const { amount, ...identity } = original.result.effects_added[0]
        return { ...identity, rule_id: ruleId, rule_rev: 1, effective_amount: amount, effective_at: original.committed_at }
      }),
    })
    expect(await reversals(client, op.op_id)).toEqual(sorted.map(studentId => ({
      student_id: studentId, kind: 'reversal', amount: 5, earned_delta: 5,
      root_transaction_id: statuses.get(studentId).result.transactions[0],
    })))
    const { accounts, effects } = await taskLedger(client, classId)
    expect(accounts).toEqual(sorted.map(studentId => ({ student_id: studentId, balance: 0, total_earned: 0 })))
    expect(effects).toMatchObject(sorted.map(studentId => ({ student_id: studentId, status: 'reversed', reversed_op_id: op.op_id })))
    expect(await Promise.all(studentIds.map(studentId => submissionRow(client, { classId, taskId, studentId })))).toEqual(before)
  })

  test('不沖回保留效果與點數，作廢擋住繳交與作業更新', async () => {
    const { client } = database()
    const { classId, taskId, studentId } = await missingTask(client)
    const ledger = await taskLedger(client, classId)
    const receipt = await commitOperation(client, voidTask(classId, taskId, false))
    expect(receipt.result).toMatchObject({ transactions: [], effects_reversed: [] })
    expect(await taskLedger(client, classId)).toEqual(ledger)
    expect(await submit(client, setStatus({ classId, taskId, studentId }, 'on_time', { rev: 2 })))
      .toMatchObject({ code: 'ENTITY_INACTIVE' })
    expect(await submit(client, updateTask(classId, taskId, { title: '改名' }, { rev: 2 })))
      .toMatchObject({ code: 'ENTITY_INACTIVE' })
  })

  test('根交易有效金額為零仍寫沖回並結束效果', async () => {
    const { client } = database()
    const { classId, taskId, studentId, statuses } = await missingTask(client, 1)
    const previous = statuses.get(studentId)
    const [rootId] = previous.result.transactions
    await client.query(`
      SELECT ppt.append_account_transaction($1,$2,$3,'correction',5,5,clock_timestamp(),$4,'測試更正',$5)
    `, [classId, studentId, previous.op_id, previous.committed_at, rootId])
    const op = voidTask(classId, taskId, true)
    const receipt = await commitOperation(client, op)
    expect(receipt.result.effects_reversed).toMatchObject([{ root_transaction_id: rootId, effective_amount: 0 }])
    expect(await reversals(client, op.op_id)).toMatchObject([{ kind: 'reversal', amount: 0, earned_delta: 0 }])
    expect((await taskLedger(client, classId)).effects).toMatchObject([{ status: 'reversed' }])
  })

  test('恢復作業不補扣分，無效轉換先於版本檢查', async () => {
    const { client } = database()
    const { classId, taskId, studentId } = await missingTask(client, 1)
    expect(await submit(client, restoreTask(classId, taskId, 99))).toMatchObject({ code: 'INVALID_TRANSITION' })
    expect(await submit(client, voidTask(classId, taskId, true, 99))).toMatchObject({ code: 'STALE_STATE' })
    const before = await submissionRow(client, { classId, taskId, studentId })
    expect(before).toMatchObject({ status: 'missing', rev: 2, basis_rev: 2 })
    await commitOperation(client, voidTask(classId, taskId, true))
    const ledger = await taskLedger(client, classId)
    expect(ledger.accounts).toMatchObject([{ balance: 0, total_earned: 0 }])
    expect(ledger.effects).toMatchObject([{ status: 'reversed' }])
    const noop = await commitOperation(client, voidTask(classId, taskId, true, 2))
    expect(noop).toMatchObject({ result: { noop: true, transactions: [] }, changes: [{ prev_rev: 2, rev: 2 }] })
    const restored = await commitOperation(client, restoreTask(classId, taskId))
    expect(restored).toMatchObject({
      result: { transactions: [] }, changes: [{ entity: 'task', prev_rev: 2, rev: 3, value: { voided: false } }],
    })
    expect(await submissionRow(client, { classId, taskId, studentId })).toEqual(before)
    expect(await taskLedger(client, classId)).toEqual(ledger)
  })

  test('未裁決歷史效果只阻止選沖回且不登記', async () => {
    const { client } = database()
    const { classId, taskId, studentId } = await missingTask(client, 1)
    await client.query(`
      INSERT INTO ppt.effects (class_id, student_id, effect_id, subject_kind, subject_key, status, origin, lineage_id)
      VALUES ($1,$2,'legacy-test','task',$3,'legacy_unresolved','legacy','legacy-test')
    `, [classId, studentId, taskId])
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    await expect(submit(client, voidTask(classId, taskId, true))).rejects.toMatchObject({
      code: '0A000', detail: 'task_void_legacy_effects',
    })
    expect(await classSnapshot(client, classId)).toBe(before)
    expect(await operationCount(client)).toBe(count)
    await commitOperation(client, voidTask(classId, taskId, false))
  })

  test('第二位學生沖回寫入後拒絕，回復兩筆並保留單一可重播收據', async () => {
    const { client } = database()
    const { classId, taskId } = await missingTask(client)
    await installSecondReversalRejection(client)
    try {
      const before = await classSnapshot(client, classId)
      const count = await operationCount(client)
      const seq = await classSequence(client, classId)
      const op = voidTask(classId, taskId, true)
      const receipt = await submit(client, op)
      expect(receipt).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD', replayed: false })
      expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
      const { rows } = await client.query('SELECT status, receipt FROM ppt.operations WHERE op_id = $1', [op.op_id])
      expect(rows).toEqual([{ status: 'rejected', receipt }])
      expect(await classSnapshot(client, classId)).toBe(before)
      expect(await operationCount(client)).toBe(count + 1)
      expect(await classSequence(client, classId)).toBe(seq)
    } finally {
      await client.query(`
        DROP TRIGGER test_reject_second_reversal ON ppt.transactions;
        DROP FUNCTION ppt.test_reject_second_reversal()
      `)
    }
  })
})
