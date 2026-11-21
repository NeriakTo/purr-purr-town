import { expect } from 'vitest'
import { authorizeAgent } from './agent.js'
import { agentApplyRule } from './agent-fixtures.js'
import { assignStudentGroups, saveGroup } from './class-student-group.js'
import { addClass, adjustment } from './operations.js'
import { connectAsRole } from './roles.js'
import { commitOperation, saveRule } from './schoolwork.js'

export const maskedViewColumns = {
  students: ['group_key'],
  groups: ['group_key', 'name'],
  transactions: ['rule_name'],
  rules: ['name', 'icon', 'category'],
  rule_versions: ['name', 'icon', 'category'],
}

export const sampleStudentNames = ['王小明', '陳大文', '歐陽小華', '司馬大中']

export async function setViewStudentNames(client, { classId, studentIds }, names = sampleStudentNames) {
  for (const [index, studentId] of studentIds.entries()) {
    await client.query(
      'UPDATE ppt.students SET name = $3 WHERE class_id = $1 AND student_id = $2',
      [classId, studentId, names[index]],
    )
  }
}

async function seedViewGroup(client, { classId, studentId }) {
  const groupKey = '組王小明'
  await commitOperation(client, saveGroup(classId, { group_key: groupKey, name: '陳大文組' }))
  await commitOperation(client, assignStudentGroups(classId, [
    { student_id: studentId, group_key: groupKey, expect: { rev: 1 } },
  ]))
}

async function seedViewLedger(client, fixture) {
  const { classId } = fixture
  const adjust = adjustment(fixture, 20)
  adjust.payload.reason = '王小明理由'
  await commitOperation(client, adjust)
  const rule = saveRule(classId, {
    name: '王小明舊規則', icon: '歐陽小華圖', category: '司馬大中類', amount: 5,
  })
  const ruleId = rule.payload.rule_id
  await commitOperation(client, rule)
  const applied = agentApplyRule(fixture, ruleId)
  await commitOperation(client, applied)
  await commitOperation(client, saveRule(classId, {
    ...rule.payload, name: '陳大文新規則', amount: 8,
  }, 1))
  return { ruleId, adjustId: adjust.op_id, appliedId: applied.op_id }
}

export async function addClassViewFixture(client, authorized = true) {
  const fixture = await addClass(client, { students: ['enrolled', 'home_study', 'transferred', 'archived'] })
  await setViewStudentNames(client, fixture)
  await seedViewGroup(client, fixture)
  const ledger = await seedViewLedger(client, fixture)
  if (authorized) await authorizeAgent(client, fixture.classId)
  return { ...fixture, ...ledger }
}

export async function listAgentViews(client) {
  const { rows } = await client.query(`
    SELECT relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ppt_agent' AND c.relkind = 'v'
    ORDER BY relname
  `)
  return rows.map(({ name }) => name)
}

export function quoteViewName(view) {
  return 'ppt_agent."' + view.replaceAll('"', '""') + '"'
}

export async function readAgentView(client, view, classId) {
  const { rows } = await client.query(
    'SELECT * FROM ' + quoteViewName(view) + ' WHERE class_id = $1', [classId],
  )
  return rows
}

export async function withViewRole(database, role, check) {
  const client = await connectAsRole(database, role)
  try {
    return await check(client)
  } finally {
    await client.end()
  }
}

export async function expectViewAccess(database, visibleClassId, hiddenClassId) {
  const { client } = database
  const views = await listAgentViews(client)
  expect(views.length).toBeGreaterThan(0)
  await withViewRole(database, 'ppt_agent', async (agent) => {
    for (const view of views) {
      expect((await readAgentView(agent, view, visibleClassId)).length, view).toBeGreaterThan(0)
      expect(await readAgentView(agent, view, hiddenClassId), view).toEqual([])
    }
    await client.query("DELETE FROM ppt.class_authorizations WHERE class_id = $1 AND actor_kind = 'agent'",
      [visibleClassId])
    for (const view of views) {
      expect(await readAgentView(agent, view, visibleClassId), view).toEqual([])
    }
    await authorizeAgent(client, visibleClassId)
    for (const view of views) {
      expect((await readAgentView(agent, view, visibleClassId)).length, view).toBeGreaterThan(0)
    }
  })
}

export async function expectViewReadDenied(database, role) {
  const views = await listAgentViews(database.client)
  expect(views.length).toBeGreaterThan(0)
  await withViewRole(database, role, async (client) => {
    for (const view of views) {
      await expect(client.query('SELECT * FROM ' + quoteViewName(view))).rejects.toMatchObject({ code: '42501' })
    }
  })
}
