import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, cancel, operationCount, submit, teacher } from './test-support/operations.js'
import { addEventRule, addSubmission, addTask, setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function fixtureWithTask(client, existing = true) {
  const fixture = await addClass(client)
  const taskId = await addTask(client, fixture.classId)
  const target = { ...fixture, taskId }
  if (existing) await addSubmission(client, target)
  return target
}

async function expectLedger(client, receipt, entries) {
  const { rows } = await client.query(`
    SELECT transaction_id, kind, amount, earned_delta, rule_id, rule_rev, root_transaction_id,
      to_jsonb(effective_at AT TIME ZONE 'UTC') #>> '{}' AS effective_at
    FROM ppt.transactions WHERE op_id = $1
  `, [receipt.op_id])
  expect(rows.map(row => row.transaction_id).sort()).toEqual([...receipt.result.transactions].sort())
  expect(rows).toMatchObject(entries)
  expect(rows).toHaveLength(entries.length)
}

async function expectAccountAndEffect(client, { classId, studentId }, { balance, effects }) {
  const { rows: [account] } = await client.query(
    'SELECT balance, total_earned FROM ppt.accounts WHERE class_id = $1 AND student_id = $2', [classId, studentId],
  )
  expect(account).toEqual({ balance: String(balance), total_earned: String(balance) })
  const { rows } = await client.query(
    'SELECT effect_id, status, root_transaction_id, reversed_op_id FROM ppt.effects WHERE class_id = $1', [classId],
  )
  expect(rows).toEqual(effects)
}

async function markMissing(client, target, ruleId) {
  const op = setStatus(target, 'missing')
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ code: 'OK', result: { noop: false, effects_reversed: [] } })
  const [effect] = receipt.result.effects_added
  const [transactionId] = receipt.result.transactions
  expect(receipt.result.effects_added).toEqual([{
    effect_id: expect.any(String), lineage_id: effect.effect_id, event: 'submission.missing',
    subject_kind: 'task', subject_key: target.taskId, root_transaction_id: transactionId, amount: -5,
  }])
  expect(receipt.changes).toEqual([
    {
      entity: 'submission', key: { task_id: target.taskId, student_id: target.studentId },
      prev_rev: 1, rev: 2, prev_basis_rev: 1, basis_rev: 2, last_op_id: op.op_id,
      prev_value: { status: 'pending', assignment_active: true },
      value: { status: 'missing', assignment_active: true },
    },
    {
      entity: 'account', key: { student_id: target.studentId }, prev_rev: 1, rev: 2, last_op_id: op.op_id,
      prev_value: { balance: 0, total_earned: 0 }, value: { balance: -5, total_earned: -5 },
    },
  ])
  await expectLedger(client, receipt, [{ kind: 'rule_auto', amount: '-5', earned_delta: '-5', rule_id: ruleId, rule_rev: 1 }])
  const active = {
    effect_id: effect.effect_id, root_transaction_id: transactionId, status: 'active', reversed_op_id: null,
  }
  await expectAccountAndEffect(client, target, { balance: -5, effects: [active] })
  return { receipt, active, transactionId }
}

describeDatabase('OP-14 繳交狀態', () => {
  const db = useTestDatabase()

  test('待收改缺交，交易、效果與版本變更寫入完整收據', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const ruleId = await addEventRule(client, target.classId)
    const { receipt } = await markMissing(client, target, ruleId)
    expect(await submissionRow(client, target)).toEqual({
      status: 'missing', rev: 2, basis_rev: 2, assignment_active: true, last_op_id: receipt.op_id,
    })
  })

  test.each(['missing', 'makeup'])('從 %s 改準時，沖回保留原版本、金額與歸屬時間', async (startingStatus) => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const ruleId = await addEventRule(client, target.classId)
    const previous = await markMissing(client, target, ruleId)
    let rev = 2
    if (startingStatus === 'makeup') {
      const makeup = await submit(client, setStatus(target, 'makeup', { rev }))
      expect(makeup).toMatchObject({
        code: 'OK', result: { noop: false, transactions: [], effects_added: [], effects_reversed: [] },
        changes: [{
          entity: 'submission', prev_rev: 2, rev: 3, prev_basis_rev: 2, basis_rev: 3,
          prev_value: { status: 'missing', assignment_active: true },
          value: { status: 'makeup', assignment_active: true },
        }],
      })
      await expectLedger(client, makeup, [])
      await expectAccountAndEffect(client, target, { balance: -5, effects: [previous.active] })
      rev += 1
    }
    await client.query(`
      WITH rule AS (
        UPDATE ppt.rules SET rev = 2 WHERE class_id = $1 AND rule_id = $2 RETURNING class_id, rule_id
      )
      INSERT INTO ppt.rule_versions (class_id, rule_id, rev, name, amount, effective_at)
      SELECT class_id, rule_id, 2, '缺交改版', -99, clock_timestamp() FROM rule
    `, [target.classId, ruleId])

    const receipt = await submit(client, setStatus(target, 'on_time', { rev }))
    expect(receipt).toMatchObject({
      code: 'OK',
      result: { noop: false, effects_added: [] },
      changes: [
        {
          entity: 'submission', prev_rev: rev, rev: rev + 1, prev_basis_rev: rev, basis_rev: rev + 1,
          prev_value: { status: startingStatus, assignment_active: true },
          value: { status: 'on_time', assignment_active: true },
        },
        { entity: 'account', prev_value: { balance: -5, total_earned: -5 }, value: { balance: 0, total_earned: 0 } },
      ],
    })
    expect(receipt.result.effects_reversed).toEqual([{
      effect_id: previous.active.effect_id, lineage_id: previous.active.effect_id,
      event: 'submission.missing', subject_kind: 'task', subject_key: target.taskId,
      rule_id: ruleId, rule_rev: 1, root_transaction_id: previous.transactionId,
      effective_amount: -5, effective_at: previous.receipt.committed_at,
    }])
    await expectLedger(client, receipt, [{
      kind: 'reversal', amount: '5', earned_delta: '5', root_transaction_id: previous.transactionId,
      effective_at: previous.receipt.committed_at.slice(0, -6),
    }])
    await expectAccountAndEffect(client, target, {
      balance: 0, effects: [{ ...previous.active, status: 'reversed', reversed_op_id: receipt.op_id }],
    })
  })

  test('更正後有效金額為零，仍新增零元沖回並結束效果', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const ruleId = await addEventRule(client, target.classId)
    const previous = await markMissing(client, target, ruleId)
    await client.query(`
      SELECT ppt.append_account_transaction($1,$2,$3,'correction',5,5,clock_timestamp(),
        $4,'測試更正',$5)
    `, [target.classId, target.studentId, previous.receipt.op_id, previous.receipt.committed_at, previous.transactionId])
    const receipt = await submit(client, setStatus(target, 'on_time', { rev: 2 }))
    expect(receipt.result.effects_reversed).toMatchObject([{ effective_amount: 0, root_transaction_id: previous.transactionId }])
    await expectLedger(client, receipt, [{ kind: 'reversal', amount: '0', earned_delta: '0' }])
    await expectAccountAndEffect(client, target, {
      balance: 0, effects: [{ ...previous.active, status: 'reversed', reversed_op_id: receipt.op_id }],
    })
  })

  test('換成另一種扣分時，帳戶收據涵蓋沖回與新扣分', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const ruleId = await addEventRule(client, target.classId)
    const lateRuleId = await addEventRule(client, target.classId, 'submission.late', -2)
    const previous = await markMissing(client, target, ruleId)
    const receipt = await submit(client, setStatus(target, 'late', { rev: 2 }))
    expect(receipt).toMatchObject({
      code: 'OK', result: {
        transactions: [expect.any(String), expect.any(String)],
        effects_reversed: [{ effect_id: previous.active.effect_id, effective_amount: -5 }],
        effects_added: [{ event: 'submission.late', amount: -2 }],
      },
      changes: [
        { entity: 'submission', value: { status: 'late' } },
        {
          entity: 'account', prev_rev: 2, rev: 4,
          prev_value: { balance: -5, total_earned: -5 }, value: { balance: -2, total_earned: -2 },
        },
      ],
    })
    const { rows } = await client.query(
      "SELECT amount, rule_id FROM ppt.transactions WHERE op_id = $1 AND kind = 'rule_auto'", [receipt.op_id],
    )
    expect(rows).toEqual([{ amount: '-2', rule_id: lateRuleId }])
  })

  test.each([false, true])('未設定或零元缺交規則不寫交易與效果，有零元規則=%s', async (hasZeroRule) => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    if (hasZeroRule) await addEventRule(client, target.classId, 'submission.missing', 0)
    const receipt = await submit(client, setStatus(target, 'missing'))
    expect(receipt).toMatchObject({ code: 'OK', result: { transactions: [], effects_added: [], effects_reversed: [] } })
    await expectLedger(client, receipt, [])
    await expectAccountAndEffect(client, target, { balance: 0, effects: [] })
  })

  test('現行版本相符才寫入，衝突收據保留目前值、版本、改動者與時間', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const first = await submit(client, setStatus(target, 'on_time'))
    expect(first.code).toBe('OK')
    const retry = await submit(client, setStatus(target, 'missing'))
    expect(retry).toMatchObject({
      code: 'STALE_STATE',
      current: {
        value: { status: 'on_time', assignment_active: true }, rev: 2,
        last_op_id: first.op_id, actor: teacher, committed_at: first.committed_at,
      },
    })
  })

  test('after_op 以成立且命中目標繳交的收據版本為準', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const first = await submit(client, setStatus(target, 'on_time'))
    expect(await submit(client, setStatus(target, 'leave', { after_op: first.op_id }))).toMatchObject({ code: 'OK' })
  })

  test.each(['rejected', 'cancelled', 'missing', 'other'])('after_op 指向 %s 時版本不符', async (priorStatus) => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    let priorId = randomUUID()
    if (priorStatus === 'rejected') priorId = (await submit(client, setStatus(target, 'on_time', { rev: 99 }))).op_id
    if (priorStatus === 'cancelled') await cancel(client, target.classId, priorId)
    if (priorStatus === 'other') priorId = (await submit(client, adjustment(target, 1))).op_id
    expect(await submit(client, setStatus(target, 'leave', { after_op: priorId }))).toMatchObject({ code: 'STALE_STATE' })
  })

  test('設定型操作必帶一個格式合法的版本條件', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    for (const version of [null, {}, { rev: 1, after_op: randomUUID() }, { rev: '1' }, { rev: -1 }, { rev: 1.1 }]) {
      const op = setStatus(target, 'on_time', version)
      if (version === null) delete op.expect
      expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })

  test('rev 0 可新建無繳交的列，已有參與列時回版本衝突', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client, false)
    const op = setStatus(target, 'pending', { rev: 0 })
    const receipt = await submit(client, op)
    expect(receipt).toMatchObject({
      code: 'OK', result: { noop: false }, changes: [{
        prev_rev: 0, prev_basis_rev: 0, prev_value: null, rev: 1, basis_rev: 1, last_op_id: op.op_id,
        value: { status: 'pending', assignment_active: true },
      }],
    })
    expect(await submit(client, setStatus(target, 'on_time', { rev: 0 }))).toMatchObject({ code: 'STALE_STATE' })
  })

  test.each([0, 4])('不參與列以 rev %i 重新建立為待收仍是改動', async (rev) => {
    const { client } = db()
    const target = await fixtureWithTask(client, false)
    await addSubmission(client, target, { rev: 4, active: false })
    const receipt = await submit(client, setStatus(target, 'pending', { rev }))
    expect(receipt).toMatchObject({
      code: 'OK', result: { noop: false }, changes: [{
        prev_rev: 4, prev_basis_rev: 0, rev: 5, basis_rev: 5,
        prev_value: { status: 'pending', assignment_active: false },
        value: { status: 'pending', assignment_active: true },
      }],
    })
    expect(await submissionRow(client, target)).toMatchObject({ rev: 5, basis_rev: 5, assignment_active: true })
  })

  test('同值成立只推進班級序號，收據仍帶當前版本', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const first = await submit(client, setStatus(target, 'on_time'))
    const op = setStatus(target, 'on_time', { rev: 2 })
    expect(await submit(client, op)).toMatchObject({
      code: 'OK', class_seq: 2, result: { noop: true, transactions: [], effects_added: [], effects_reversed: [] },
      changes: [{
        prev_rev: 2, rev: 2, prev_basis_rev: 2, basis_rev: 2, last_op_id: op.op_id,
        prev_value: { status: 'on_time', assignment_active: true },
        value: { status: 'on_time', assignment_active: true },
      }],
    })
    expect(await submissionRow(client, target)).toMatchObject({ rev: 2, basis_rev: 2, last_op_id: first.op_id })
  })

  test('作廢作業或轉出封存學生會拒絕，缺少目標優先回 NOT_FOUND', async () => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const voidedTask = await addTask(client, target.classId, { voided: true })
    expect(await submit(client, setStatus({ ...target, taskId: voidedTask }, 'on_time')))
      .toMatchObject({ code: 'ENTITY_INACTIVE' })
    for (const enrollment of ['transferred', 'archived']) {
      await client.query('UPDATE ppt.students SET enrollment_status = $2 WHERE class_id = $1', [target.classId, enrollment])
      expect(await submit(client, setStatus(target, 'on_time'))).toMatchObject({ code: 'ENTITY_INACTIVE' })
      expect(await submit(client, setStatus({ ...target, taskId: randomUUID() }, 'on_time')))
        .toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  test.each(['daily_quest', 'only_if_no_proposal', 'legacy_unresolved'])('未實作分支 %s 拋例外且整筆不留資料', async (key) => {
    const { client } = db()
    const target = await fixtureWithTask(client)
    const op = setStatus(target, 'on_time')
    if (key === 'daily_quest') await addEventRule(client, target.classId, 'daily_quest.complete', 5)
    if (key === 'only_if_no_proposal') op.payload.only_if_no_proposal = false
    if (key === 'legacy_unresolved') await client.query(`
      INSERT INTO ppt.effects (class_id, student_id, effect_id, event, subject_kind, subject_key, status, origin, lineage_id)
      VALUES ($1,$2,'legacy-test',NULL,'task',$3,'legacy_unresolved','legacy','legacy-test')
    `, [target.classId, target.studentId, target.taskId])
    const snapshot = await classSnapshot(client, target.classId)
    const count = await operationCount(client)
    await expect(submit(client, op)).rejects.toMatchObject({ code: '0A000', detail: key })
    expect(await classSnapshot(client, target.classId)).toBe(snapshot)
    expect(await operationCount(client)).toBe(count)
  })
})
