import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { addAgentClass } from './test-support/agent-fixtures.js'
import {
  addSchoolworkViewFixture, expectViewReadDenied, listAgentViews, quoteViewName, readAgentView,
  setViewStudentNames, withViewRole,
} from './test-support/agent-views.js'
import { adjustment, submit } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function expectDenied(client, statement, values = []) {
  await expect(client.query(statement, values), statement).rejects.toMatchObject({ code: '42501' })
}

async function expectViewWriteRejection(agent, target) {
  const { rows: [{ allowed, updatable }] } = await agent.query(`
    SELECT pg_catalog.has_table_privilege(current_user, $1, 'INSERT, UPDATE, DELETE') AS allowed,
           pg_catalog.pg_relation_is_updatable($1::regclass, false) AS updatable
  `, [target])
  expect(allowed, target).toBe(false)
  const attempts = [
    [8, 'INSERT INTO ' + target + ' (class_id) SELECT class_id FROM ' + target + ' WHERE false'],
    [4, 'UPDATE ' + target + ' SET class_id = class_id WHERE false'],
    [16, 'DELETE FROM ' + target + ' WHERE false'],
  ]
  for (const [flag, statement] of attempts) {
    // PostgreSQL can reject an inherently read-only view before checking its ACL.
    const code = (updatable & flag) !== 0 ? '42501' : '55000'
    await expect(agent.query(statement), statement).rejects.toMatchObject({ code })
  }
}

async function accessibleApplicationFunctions(agent) {
  const { rows } = await agent.query(`
    SELECT n.nspname || '.' || p.proname AS routine,
           pg_catalog.oidvectortypes(p.proargtypes) AS argument_types,
           p.prosecdef AS security_definer
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('ppt', 'ppt_agent')
      AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
    ORDER BY routine, argument_types
  `)
  return rows
}

async function privateTableNames(agent) {
  const { rows } = await agent.query(`
    SELECT pg_catalog.format('%I.%I', schemaname, tablename) AS name
    FROM pg_catalog.pg_tables WHERE schemaname = 'ppt' ORDER BY tablename
  `)
  return rows.map(row => row.name)
}

async function privateFunctionChecks(agent) {
  const { rows } = await agent.query(`
    SELECT pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, coalesce((
      SELECT pg_catalog.string_agg(
        CASE WHEN a.position = p.pronargs AND p.provariadic <> 0 THEN 'VARIADIC ' ELSE '' END
        || 'NULL::' || pg_catalog.format_type(a.type_oid, NULL), ', ' ORDER BY a.position)
      FROM pg_catalog.unnest(p.proargtypes) WITH ORDINALITY AS a(type_oid, position)
    ), '')) AS invocation
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ppt' AND p.prokind = 'f'
    ORDER BY invocation
  `)
  return rows.map(row => 'SELECT ' + row.invocation)
}

async function checkPublicReads(database, views) {
  const client = await database.connect()
  const role = 'ppt_test_public_' + randomUUID().replaceAll('-', '')
  await client.query('BEGIN')
  try {
    await client.query('CREATE ROLE ' + role + ' NOLOGIN')
    await client.query('SET LOCAL ROLE ' + role)
    const { rows: [identity] } = await client.query('SELECT current_user')
    expect(identity.current_user).toBe(role)
    for (const view of views) {
      await client.query('SAVEPOINT public_read')
      try {
        await expectDenied(client, 'SELECT * FROM ' + quoteViewName(view))
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT public_read')
        await client.query('RELEASE SAVEPOINT public_read')
      }
    }
  } finally {
    await client.query('ROLLBACK')
  }
}

describeDatabase('小野檢視表的資料庫權限', () => {
  const database = useTestDatabase()

  it('X22 空名單只回原文，應用 schema 只有兩支函式可執行', async () => {
    const { client } = database()
    await setViewStudentNames(client, await addAgentClass(client))
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      const { rows } = await agent.query(
        "SELECT ppt_agent.mask_student_names($1, '[]'::jsonb) AS result", ['王小明'],
      )
      expect(rows).toEqual([{ result: '王小明' }])
      expect(await accessibleApplicationFunctions(agent)).toEqual([
        { routine: 'ppt_agent.agent_submit', argument_types: 'text, text, jsonb, text', security_definer: true },
        { routine: 'ppt_agent.mask_student_names', argument_types: 'text, jsonb', security_definer: false },
      ])
    })
  })

  it('X23 小野與老師提交同一訂正備註，只有小野原文保留', async () => {
    const { classId, correctionIds } = await addSchoolworkViewFixture(database())
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      const rows = await readAgentView(agent, 'corrections', classId)
      const notes = Object.fromEntries(rows.map(row => [row.correction_id, row.note]))
      expect(notes).toEqual({
        [correctionIds.agent]: '請王小明重寫',
        [correctionIds.teacher]: '請1號重寫',
        [correctionIds.imported]: '請1號重寫',
      })
    })
  })

  it('全部檢視表沒有寫入權，寫入依可更新性回 42501 或 55000', async () => {
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      for (const view of await listAgentViews(agent)) {
        await expectViewWriteRejection(agent, quoteViewName(view))
      }
    })
  })

  it('全部檢視表沒有 TRUNCATE 權限，清空指令由 PostgreSQL 以 42809 拒絕', async () => {
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      for (const view of await listAgentViews(agent)) {
        const target = quoteViewName(view)
        const { rows } = await agent.query(
          "SELECT pg_catalog.has_table_privilege(current_user, $1, 'TRUNCATE') AS allowed", [target],
        )
        expect(rows, target).toEqual([{ allowed: false }])
        await expect(agent.query('TRUNCATE ' + target), target).rejects.toMatchObject({ code: '42809' })
      }
    })
  })

  it('全部檢視表拒絕四種列鎖，網站仍可操作同一班級', async () => {
    const fixture = await addAgentClass(database().client)
    const options = ['UPDATE', 'SHARE', 'NO KEY UPDATE', 'KEY SHARE']
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      for (const view of await listAgentViews(agent)) {
        for (const option of options) {
          await expectDenied(agent, 'SELECT * FROM ' + quoteViewName(view) + ' WHERE class_id = $1 FOR ' + option,
            [fixture.classId])
        }
      }
      await withViewRole(database(), 'ppt_web', async (web) => {
        await expectDenied(web, 'SELECT class_id FROM ppt.classes WHERE class_id = $1 FOR UPDATE NOWAIT',
          [fixture.classId])
        expect(await submit(web, adjustment(fixture, 1))).toMatchObject({ status: 'committed', code: 'OK' })
      })
      await withViewRole(database(), 'ppt_owner', async (owner) => {
        const { rows } = await owner.query('SELECT class_id FROM ppt.classes WHERE class_id = $1 FOR UPDATE NOWAIT',
          [fixture.classId])
        expect(rows).toEqual([{ class_id: fixture.classId }])
      })
    })
  })

  it('小野直接讀取每張 ppt 表都得 42501', async () => {
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      const tables = await privateTableNames(agent)
      expect(tables).toContain('ppt.students')
      for (const name of tables) await expectDenied(agent, 'SELECT * FROM ' + name + ' LIMIT 0')
    })
  })

  it('小野直接呼叫每支 ppt 函式都得 42501', async () => {
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      const calls = await privateFunctionChecks(agent)
      expect(calls).toContain('SELECT ppt.system_actor()')
      for (const call of calls) await expectDenied(agent, call)
    })
  })

  it('ANALYZE 後小野的 pg_stats 仍沒有 ppt 統計資料', async () => {
    const { client } = database()
    await addAgentClass(client)
    await client.query('ANALYZE ppt.students')
    const statement = "SELECT tablename FROM pg_catalog.pg_stats WHERE schemaname = 'ppt'"
    expect((await client.query(statement)).rows.some(row => row.tablename === 'students')).toBe(true)
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      expect((await agent.query(statement)).rows).toEqual([])
    })
  })

  it('網站、備份與只有 PUBLIC 權限的角色讀各檢視表都得 42501', async () => {
    const views = await listAgentViews(database().client)
    await expectViewReadDenied(database(), 'ppt_web')
    await expectViewReadDenied(database(), 'ppt_backup')
    await checkPublicReads(database(), views)
  })
})
