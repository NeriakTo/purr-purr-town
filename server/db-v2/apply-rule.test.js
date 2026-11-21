import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, operation, retireRule, saveRule } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function applyRule({ classId, studentId }, rule, version = 1) {
  return operation(classId, 'points.apply_rule', { student_id: studentId, rule_id: rule.rule_id, rule_version: version })
}

async function submitAsAgent(client, op) {
  const { receipts: [receipt] } = await agentSubmit(client, op.class_id, [op])
  return receipt
}

async function getTransaction(client, receipt) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.transactions WHERE transaction_id = $1', [receipt.result.transactions[0]],
  )
  return row
}

describeDatabase('OP-25 套用手動規則', () => {
  const database = useTestDatabase()

  test('在家自學也可套用，交易記規則版本、理由與金額，沒有事件效果', async () => {
    const { client } = database()
    const target = await addClass(client, { students: ['home_study'] })
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    const receipt = await commitOperation(client, applyRule(target, rule.payload))
    expect(receipt.changes).toEqual([expect.objectContaining({
      entity: 'account', value: { balance: 5, total_earned: 5 },
    })])
    expect(await getTransaction(client, receipt)).toMatchObject({
      kind: 'adjust', amount: '5', earned_delta: '5', reason: rule.payload.name,
      rule_id: rule.payload.rule_id, rule_rev: 1,
    })
    const { rows } = await client.query('SELECT * FROM ppt.effects WHERE class_id = $1', [target.classId])
    expect(rows).toEqual([])
  })

  test('停用優先拒絕，重新啟用後只接受第三版', async () => {
    const { client } = database()
    const target = await addClass(client)
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    await commitOperation(client, retireRule(target.classId, rule.payload.rule_id, 1))
    for (const version of [1, 2]) {
      expect(await submit(client, applyRule(target, rule.payload, version))).toMatchObject({ code: 'ENTITY_INACTIVE' })
    }
    await commitOperation(client, saveRule(target.classId, rule.payload, 2))
    for (const version of [1, 2]) {
      expect(await submit(client, applyRule(target, rule.payload, version))).toMatchObject({ code: 'RULE_VERSION_STALE' })
    }
    const receipt = await commitOperation(client, applyRule(target, rule.payload, 3))
    expect(await getTransaction(client, receipt)).toMatchObject({ rule_rev: 3 })
  })

  test('規則改價後拒絕舊版與未來版，只回現行金額和版本', async () => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId, { amount: 100 })
    await commitOperation(client, rule)
    await commitOperation(client, saveRule(target.classId, { ...rule.payload, amount: 50 }, 1))
    const before = await classSnapshot(client, target.classId)
    for (const [send, rev] of [[submit, 1], [submitAsAgent, 1], [submit, 9]]) {
      const receipt = await send(client, applyRule(target, rule.payload, rev))
      expect(receipt.code).toBe('RULE_VERSION_STALE')
      expect(receipt.current).toEqual({ rev: 2, value: { amount: 50 } })
    }
    expect(await classSnapshot(client, target.classId)).toBe(before)
    const receipt = await commitOperation(client, applyRule(target, rule.payload, 2))
    expect(await getTransaction(client, receipt)).toMatchObject({ amount: '50', rule_rev: 2 })
  })

  test('事件規則拒絕，零元手動規則寫入一筆交易', async () => {
    const { client } = database()
    const target = await addClass(client)
    const event = saveRule(target.classId, { kind: 'event', event: 'submission.missing', amount: -10 })
    const zero = saveRule(target.classId, { amount: 0 })
    await commitOperation(client, event)
    await commitOperation(client, zero)
    expect(await submit(client, applyRule(target, event.payload))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    const receipt = await commitOperation(client, applyRule(target, zero.payload))
    expect(await getTransaction(client, receipt)).toMatchObject({ amount: '0', earned_delta: '0' })
  })

  test('跨班依身分回不同結果，轉出與停用回無效', async () => {
    const { client } = database()
    const target = await addClass(client, { students: ['enrolled', 'transferred'] })
    const other = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    const otherRule = saveRule(other.classId)
    await commitOperation(client, rule)
    await commitOperation(client, otherRule)
    for (const [studentId, payload] of [[other.studentId, rule.payload], [target.studentId, otherRule.payload]]) {
      const scoped = { ...target, studentId }
      expect(await submit(client, applyRule(scoped, payload))).toMatchObject({ code: 'NOT_FOUND' })
      const receipt = await submitAsAgent(client, applyRule(scoped, payload))
      expect(receipt.code).toBe('SCOPE_FORBIDDEN')
      expect(receipt).not.toHaveProperty('current')
    }
    expect(await submit(client, applyRule({ ...target, studentId: target.studentIds[1] }, rule.payload)))
      .toMatchObject({ code: 'ENTITY_INACTIVE' })
    await commitOperation(client, retireRule(target.classId, rule.payload.rule_id, 1))
    expect(await submitAsAgent(client, applyRule(target, rule.payload))).toMatchObject({ code: 'ENTITY_INACTIVE' })
  })

  test.each([
    ['小野先套用', submitAsAgent, submit, 'agent', 'teacher'],
  ])('%s，另一位收到六鍵提示且重送沿用原提示', async (_name, first, second, priorKind, actorKind) => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    const prior = await first(client, applyRule(target, rule.payload))
    const op = applyRule(target, rule.payload)
    const receipt = await second(client, op)
    expect(receipt.warnings).toEqual([{
      code: 'POSSIBLE_DUPLICATE', student_id: target.studentId, rule_id: rule.payload.rule_id,
      prior_op_id: prior.op_id, prior_actor_kind: priorKind, prior_at: prior.committed_at,
    }])
    expect(receipt.status).toBe('committed')
    const { rows: [actor] } = await client.query('SELECT actor_kind FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(actor.actor_kind).toBe(actorKind)
    const before = await classSnapshot(client, target.classId)
    expect(await second(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  test('老師先套用，小野同日再套暫緩且重送沿用暫緩收據', async () => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    await commitOperation(client, rule)
    await submit(client, applyRule(target, rule.payload))
    const op = applyRule(target, rule.payload)
    const receipt = await submitAsAgent(client, op)
    expect(receipt).toMatchObject({
      status: 'held', code: 'HELD_FOR_TEACHER', warnings: [],
      result: { held_reason: 'rule_applied_today', transactions: [] },
    })
    const { rows } = await client.query('SELECT 1 FROM ppt.transactions WHERE op_id = $1', [op.op_id])
    expect(rows).toEqual([])
    const { rows: [actor] } = await client.query('SELECT actor_kind FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(actor.actor_kind).toBe('agent')
    const before = await classSnapshot(client, target.classId)
    expect(await submitAsAgent(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await classSnapshot(client, target.classId)).toBe(before)
  })

  test('同一位操作者、不同規則、不同學生都不提示', async () => {
    const { client } = database()
    const target = await addClass(client, { students: ['enrolled', 'enrolled'] })
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    const anotherRule = saveRule(target.classId)
    await commitOperation(client, rule)
    await commitOperation(client, anotherRule)
    await commitOperation(client, applyRule(target, rule.payload))
    expect((await commitOperation(client, applyRule(target, rule.payload))).warnings).toEqual([])
    for (const [studentId, payload] of [[target.studentId, anotherRule.payload], [target.studentIds[1], rule.payload]]) {
      const receipt = await submitAsAgent(client, applyRule({ ...target, studentId }, payload))
      expect(receipt).toMatchObject({ status: 'committed', warnings: [] })
    }
  })

  test.each([[11, 0], [9, 1]])('小野在 %i 分鐘前套用，老師收到 %i 項提示', async (minutes, count) => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const rule = saveRule(target.classId)
    const anotherRule = saveRule(target.classId)
    await commitOperation(client, rule)
    await commitOperation(client, anotherRule)
    const prior = await submitAsAgent(client, applyRule(target, anotherRule.payload))
    expect(prior.status).toBe('committed')
    await client.query(`
      SELECT ppt.append_account_transaction($1, $2, $3, 'adjust', 5, 5,
        clock_timestamp() - make_interval(mins => $4), clock_timestamp(), '測試理由', null, $5, 1)
    `, [target.classId, target.studentId, prior.op_id, minutes, rule.payload.rule_id])
    const receipt = await commitOperation(client, applyRule(target, rule.payload))
    expect(receipt.warnings).toHaveLength(count)
    if (count) expect(receipt.warnings[0].prior_op_id).toBe(prior.op_id)
  })

  test('接受匯入的文字規則編號', async () => {
    const { client } = database()
    const target = await addClass(client)
    const id = randomUUID().replaceAll('-', '').repeat(2)
    await client.query(`
      WITH rule AS (
        INSERT INTO ppt.rules (class_id, rule_id, kind) VALUES ($1, $2, 'manual') RETURNING *
      )
      INSERT INTO ppt.rule_versions (class_id, rule_id, rev, name, amount, effective_at)
      SELECT class_id, rule_id, rev, '測試規則', 5, clock_timestamp() FROM rule
    `, [target.classId, id])
    const receipt = await commitOperation(client, applyRule(target, { rule_id: id }))
    expect(await getTransaction(client, receipt)).toMatchObject({ rule_id: id })
  })
})
