import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { addAgentClass, addAgentTask, addManualRule, setAgentLimits } from './test-support/agent-fixtures.js'
import { batchUndo } from './test-support/batch-undo.js'
import { uuidV5 } from './test-support/batch-uuid.js'
import { classSnapshot } from './test-support/checks.js'
import { saveComment, system } from './test-support/comments.js'
import { confirm } from './test-support/confirmations.js'
import { addClass, adjustment, cancel, submit } from './test-support/operations.js'
import { agentSubmitAs, connectAsRole } from './test-support/roles.js'
import { commitOperation, retireRule, saveRule } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function pptTables(client) {
  const { rows } = await client.query(`
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_catalog.pg_tables WHERE schemaname = 'ppt' ORDER BY tablename
  `)
  expect(rows.map(row => row.name)).toContain('ppt.operations')
  return rows.map(row => row.name)
}

async function expectDenied(client, statements) {
  for (const statement of statements) {
    await expect(client.query(statement), statement).rejects.toMatchObject({ code: '42501' })
  }
}

const writeRules = [
  'INSERT INTO ppt.rule_versions SELECT * FROM ppt.rule_versions WHERE false',
  'UPDATE ppt.rules SET disabled = true WHERE false',
]

const writeAuditRecords = [
  "UPDATE ppt.operations SET receipt = '{}'::jsonb WHERE false",
  'DELETE FROM ppt.operations WHERE false',
  "UPDATE ppt.agent_calls SET note = '測試改寫' WHERE false",
  "UPDATE ppt.confirmations SET status = 'superseded' WHERE false",
]

const readPrivateData = [
  'SELECT name FROM ppt.students',
  'SELECT * FROM ppt.comments',
  'SELECT reason FROM ppt.transactions',
  'SELECT payload FROM ppt.operations',
]

const callInternalAgentEntry = "SELECT ppt.agent_submit(NULL::text, NULL::text, '[]'::jsonb, NULL::text)"
const callLockedSubmit = 'SELECT ppt.submit_locked_operation(NULL::jsonb, NULL::jsonb)'

async function assertForbiddenAgentOperations(client, agent, classId, ops) {
  const before = await classSnapshot(client, classId)
  const { receipts } = await agentSubmitAs(agent, classId, ops)
  expect(receipts.map(({ op_id, status, code }) => ({ op_id, status, code }))).toEqual(
    ops.map(({ op_id }) => ({ op_id, status: 'rejected', code: 'FORBIDDEN_ROLE' })),
  )
  expect(await classSnapshot(client, classId)).toBe(before)
}

async function seedPrivateData(client) {
  const fixture = await addClass(client)
  await commitOperation(client, saveComment(fixture, { comment: '評語記號甲' }))
  const op = adjustment(fixture)
  op.payload.reason = '扣分理由記號甲'
  await commitOperation(client, op)
  return fixture
}

async function readActivity(client, pid) {
  const { rows } = await client.query(
    'SELECT query, state FROM pg_catalog.pg_stat_activity WHERE pid = $1', [pid],
  )
  expect(rows).toHaveLength(1)
  return rows[0]
}

describeDatabase('資料庫角色越權驗收', () => {
  const db = useTestDatabase()

  test.each([['X01', 'ppt_agent'], ['X02', 'ppt_web'], ['X03', 'ppt_backup']])(
    '%s %s 無法刪除任何 ppt 表的資料',
    async (_id, role) => {
      const tables = await pptTables(db().client)
      const client = await connectAsRole(db(), role)
      await expectDenied(client, tables.map(table => 'DELETE FROM ' + table + ' WHERE false'))
    },
  )

  test('X04 網站無法清空沒有觸發程序的學生表', async () => {
    const { rows } = await db().client.query(`
      SELECT tgname FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'ppt.students'::regclass AND NOT tgisinternal
    `)
    expect(rows).toEqual([])
    const web = await connectAsRole(db(), 'ppt_web')
    await expectDenied(web, ['TRUNCATE ppt.students'])
  })

  test.each(['ppt_agent', 'ppt_backup'])('X05 %s 無法清空任何 ppt 表', async role => {
    const tables = await pptTables(db().client)
    const client = await connectAsRole(db(), role)
    await expectDenied(client, tables.map(table => 'TRUNCATE ' + table))
  })

  test('X06 小野無法直接新增規則版本或停用規則', async () => {
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, writeRules)
  })

  test('X07 小野經入口送 OP-38 與 OP-39 遭拒，班級資料相同', async () => {
    const { client } = db()
    const { classId } = await addAgentClass(client)
    const ruleId = await addManualRule(client, classId)
    const agent = await connectAsRole(db(), 'ppt_agent')
    await assertForbiddenAgentOperations(client, agent, classId, [saveRule(classId), retireRule(classId, ruleId, 1)])
  })

  test('X08 小野無法直接更改 agentLimits，經入口送 OP-43 也遭拒', async () => {
    const { client } = db()
    const { classId } = await addAgentClass(client)
    await setAgentLimits(client, classId, {})
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, [
      `UPDATE ppt.settings_entries SET value = jsonb_set(value, '{max_students_per_call}', '50')
       WHERE key = 'agentLimits'`,
    ])
    const { rows: [{ value }] } = await client.query(
      "SELECT value FROM ppt.settings_entries WHERE class_id = $1 AND key = 'agentLimits'", [classId],
    )
    const op = setSetting(classId, 'agentLimits', { ...value, max_students_per_call: 50 }, { rev: 1 })
    await assertForbiddenAgentOperations(client, agent, classId, [op])
  })

  test('X09 網站無法直接新增規則版本或停用規則', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    await expectDenied(web, writeRules)
  })

  test.each(['ppt_agent', 'ppt_web', 'ppt_backup'])('X10 %s 無法直接改寫操作與確認紀錄', async role => {
    const client = await connectAsRole(db(), role)
    await expectDenied(client, writeAuditRecords)
  })

  test('X11 小野不能確認、退回或整批撤銷自己的暫緩批次', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client, 6)
    const { classId } = fixture
    const ops = (await addAgentTask(client, fixture, -5)).map(target => setStatus(target, 'missing'))
    const agent = await connectAsRole(db(), 'ppt_agent')
    const batch = await agentSubmitAs(agent, classId, ops)
    const confirmationId = ops[0].op_id
    expect(batch.receipts.map(receipt => receipt.code)).toEqual(ops.map(() => 'HELD_FOR_TEACHER'))
    await assertForbiddenAgentOperations(client, agent, classId, [
      confirm(classId, confirmationId),
      confirm(classId, confirmationId, 'confirmation.reject'),
      batchUndo(classId, batch.call_id, ops.length),
    ])
  })

  test('X12 小野無法直接呼叫暫緩確認函式', async () => {
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, [
      "SELECT ppt.apply_held_agent_confirmation(NULL::ppt.confirmations, 'confirmed'::ppt.confirmation_status, NULL::text, now())",
      "SELECT ppt.resolve_held_agent_operation(NULL::jsonb, NULL::jsonb, 'confirmed'::ppt.confirmation_status, now(), now())",
    ])
  })

  test('X13 小野無法讀取姓名、評語、扣分理由與操作輸入', async () => {
    await seedPrivateData(db().client)
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, readPrivateData)
  })

  test('X17 小野帶老師身分仍無法直接呼叫網站入口', async () => {
    const fixture = await addAgentClass(db().client)
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expect(submit(agent, adjustment(fixture))).rejects.toMatchObject({ code: '42501' })
  })

  test('X18 小野無法呼叫未包裝入口與三支內部提交函式', async () => {
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, [
      callInternalAgentEntry,
      callLockedSubmit,
      'SELECT ppt.execute_claimed_operation(NULL::jsonb, NULL::jsonb, now())',
      "SELECT ppt.execute_new_agent_operations('[]'::jsonb, NULL::jsonb)",
    ])
  })

  test('X19 網站無法呼叫內部提交函式或未包裝的小野入口', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    await expectDenied(web, [callLockedSubmit, callInternalAgentEntry])
  })

  test('X20 網站入口拒絕小野身分與系統身分的 OP-24，班級資料相同', async () => {
    const { client } = db()
    const fixture = await addAgentClass(client)
    const before = await classSnapshot(client, fixture.classId)
    const web = await connectAsRole(db(), 'ppt_web')
    const agent = { kind: 'agent', id: 'agent' }
    await expect(submit(web, adjustment(fixture), agent)).rejects.toMatchObject({ code: '22023' })
    const op = { ...adjustment(fixture), op_id: uuidV5(fixture.classId, 'X20') }
    expect(await submit(web, op, system)).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_ROLE' })
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
  })

  test('X21 小野無法替自己寫入另一班的授權', async () => {
    const { classId } = await addClass(db().client)
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expect(agent.query(
      "INSERT INTO ppt.class_authorizations (class_id, actor_kind) VALUES ($1, 'agent')", [classId],
    )).rejects.toMatchObject({ code: '42501' })
  })

  test('X26 小野看不到網站連線含姓名記號的查詢文字', async () => {
    const [web, agent] = await Promise.all([connectAsRole(db(), 'ppt_web'), connectAsRole(db(), 'ppt_agent')])
    const marker = '姓名記號甲'
    await web.query('BEGIN')
    try {
      await web.query(`SELECT '${marker}'::text`)
      const visible = await readActivity(db().client, web.processID)
      expect(visible.state).toBe('idle in transaction')
      expect(visible.query).toContain(marker)
      const hidden = await readActivity(agent, web.processID)
      expect([null, '<insufficient privilege>']).toContain(hidden.query)
    } finally {
      await web.query('ROLLBACK')
    }
  })

  test('X27 小野無法建立暫存函式', async () => {
    const agent = await connectAsRole(db(), 'ppt_agent')
    await expectDenied(agent, [
      'CREATE FUNCTION pg_temp.test_temp_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
    ])
  })

  test('X28 備份能讀取每張 ppt 表，包含姓名與評語', async () => {
    const { client } = db()
    const { classId } = await seedPrivateData(client)
    const tables = await pptTables(client)
    const backup = await connectAsRole(db(), 'ppt_backup')
    for (const table of tables) {
      await expect(backup.query('SELECT * FROM ' + table + ' LIMIT 1'), table).resolves.toBeDefined()
    }
    const students = await backup.query('SELECT name FROM ppt.students WHERE class_id = $1', [classId])
    const comments = await backup.query('SELECT comment FROM ppt.comments WHERE class_id = $1', [classId])
    expect(students.rows).toEqual([{ name: '1號村民' }])
    expect(comments.rows).toEqual([{ comment: '評語記號甲' }])
  })

  test('X29 備份無法呼叫兩個網站入口與小野入口', async () => {
    const fixture = await addAgentClass(db().client)
    const backup = await connectAsRole(db(), 'ppt_backup')
    await expect(submit(backup, adjustment(fixture))).rejects.toMatchObject({ code: '42501' })
    await expect(cancel(backup, fixture.classId, randomUUID())).rejects.toMatchObject({ code: '42501' })
    await expect(agentSubmitAs(backup, fixture.classId, [])).rejects.toMatchObject({ code: '42501' })
  })
})
