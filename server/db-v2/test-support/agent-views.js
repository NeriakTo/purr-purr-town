import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { authorizeAgent } from './agent.js'
import { addManualRule, agentApplyRule, setAgentLimits } from './agent-fixtures.js'
import { assignStudentGroups, saveGroup } from './class-student-group.js'
import { propose } from './confirmations.js'
import { createRound, requireRound } from './correction-rounds.js'
import { addImportedEffect, resolveLegacyEffect } from './legacy-effects.js'
import { addClass, adjustment } from './operations.js'
import { addPayrollJob, saveJob, setDuty } from './payroll.js'
import { agentSubmitAs, connectAsRole } from './roles.js'
import { commitOperation, createTask, saveRule } from './schoolwork.js'
import { addSubmission } from './submissions.js'

export const maskedViewColumns = {
  students: ['group_key'],
  groups: ['group_key', 'name'],
  transactions: ['rule_name'],
  rules: ['name', 'icon', 'category'],
  rule_versions: ['name', 'icon', 'category'],
  tasks: ['title', 'task_type', 'page_text'],
  corrections: ['note'],
  jobs: ['title', 'icon', 'category'],
}

export const sampleStudentNames = ['王小明', '陳大文', '歐陽小華', '司馬大中']

function viewTextSource(view, columns, write, match = {}) {
  return Object.fromEntries(columns.map((column) => [
    column, { view, column, write, match },
  ]))
}

async function writeMaskTask(client, { classId }, value) {
  await commitOperation(client, createTask(classId, { title: value, task_type: value, page_text: value }))
}

async function writeMaskGroup(client, { classId, studentId }, value) {
  await commitOperation(client, saveGroup(classId, { group_key: value, name: value }))
  await commitOperation(client, assignStudentGroups(classId, [
    { student_id: studentId, group_key: value, expect: { rev: 1 } },
  ]))
}

async function writeMaskRule(client, fixture, value) {
  const rule = saveRule(fixture.classId, { name: value, icon: value, category: value })
  await commitOperation(client, rule)
  await commitOperation(client, agentApplyRule(fixture, rule.payload.rule_id))
  await commitOperation(client, saveRule(fixture.classId, {
    ...rule.payload, amount: 8,
  }, 1))
}

async function writeMaskJob(client, { classId }, value) {
  await commitOperation(client, saveJob(classId, { title: value, icon: value, category: value }))
}

async function writeMaskCorrection(client, { classId, studentId }, value) {
  const task = createTask(classId)
  await commitOperation(client, task)
  await createRound(client, { classId, studentId, taskId: task.payload.task_id }, { note: value })
}

export const maskedColumns = {
  students: viewTextSource('students', ['group_key'], writeMaskGroup, { seat_number: 1 }),
  groups: viewTextSource('groups', ['group_key', 'name'], writeMaskGroup),
  transactions: viewTextSource('transactions', ['rule_name'], writeMaskRule, { rule_rev: 1 }),
  rules: viewTextSource('rules', ['name', 'icon', 'category'], writeMaskRule, { rev: 2 }),
  rule_versions: viewTextSource('rule_versions', ['name', 'icon', 'category'], writeMaskRule, { rev: 2 }),
  tasks: viewTextSource('tasks', ['title', 'task_type', 'page_text'], writeMaskTask),
  corrections: viewTextSource('corrections', ['note'], writeMaskCorrection),
  jobs: viewTextSource('jobs', ['title', 'icon', 'category'], writeMaskJob),
}

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

export async function addClassViewFixture(client) {
  const fixture = await addClass(client, { students: ['enrolled', 'home_study', 'transferred', 'archived'] })
  await setViewStudentNames(client, fixture)
  await seedViewGroup(client, fixture)
  const ledger = await seedViewLedger(client, fixture)
  await authorizeAgent(client, fixture.classId)
  return { ...fixture, ...ledger }
}

async function seedViewTask(client, { classId, studentIds }) {
  const [first, second, transferred] = studentIds
  const task = createTask(classId, {
    title: '王 小明和小華的作業', task_type: '王　小明類', page_text: 'Page 12，王小明和小明',
    assignee_ids: [first, second],
  })
  await commitOperation(client, task)
  const taskId = task.payload.task_id
  const unresolved = { classId, taskId, studentId: first }
  const resolved = { classId, taskId, studentId: second }
  await addSubmission(client, { classId, taskId, studentId: transferred }, { active: false })
  await addImportedEffect(client, unresolved)
  const effectId = await addImportedEffect(client, resolved)
  await commitOperation(client, resolveLegacyEffect({ ...resolved, effectId }, 'none'))
  return taskId
}

async function seedViewCorrections(database, { classId, studentIds }, taskId) {
  const { client } = database
  const [first, second, transferred] = studentIds
  const note = '請王小明重寫'
  const teacherRound = await createRound(client, { classId, taskId, studentId: first }, { note })
  const agentOp = requireRound({ classId, taskId, studentId: second }, { note })
  const { receipts } = await withViewRole(database, 'ppt_agent', agent =>
    agentSubmitAs(agent, classId, [agentViewEntry(agentOp)]),
  )
  expect(receipts).toMatchObject([{ status: 'committed', code: 'OK' }])
  const imported = randomUUID()
  await client.query(`
    INSERT INTO ppt.corrections (class_id, correction_id, task_id, student_id, round, status, note)
    VALUES ($1, $2, $3, $4, 1, 'required', $5)
  `, [classId, imported, taskId, transferred, note])
  return { teacher: teacherRound.correctionId, agent: agentOp.payload.correction_id, imported }
}

async function seedViewDuties(client, { classId, studentIds }) {
  const [first, second, transferred] = studentIds
  const jobId = await addPayrollJob(client, classId, [transferred, first], {
    title: '王小明值日', cycle: 'daily', icon: '歐陽小華圖', category: '司馬大中類',
  })
  const dutyDate = '2026-11-22'
  await commitOperation(client, setDuty(classId, dutyDate, [second, first, transferred]))
  return { jobId, dutyDate }
}

export async function addSchoolworkViewFixture(database) {
  const { client } = database
  const fixture = await addClassViewFixture(client)
  const taskId = await seedViewTask(client, fixture)
  const correctionIds = await seedViewCorrections(database, fixture, taskId)
  const duties = await seedViewDuties(client, fixture)
  return { ...fixture, taskId, correctionIds, ...duties }
}

export const viewMaxPendingHeld = 2

export function makeViewHeldEntries(fixture) {
  const { classId, studentIds: [first, second], heldRuleId } = fixture
  return [
    agentApplyRule({ classId, studentId: second }, heldRuleId),
    { ...agentApplyRule({ classId, studentId: first }, heldRuleId), client_time: null },
  ].map(agentViewEntry)
}

function agentViewEntry(op) {
  const { class_id: _classId, ...entry } = op
  return entry
}

async function seedAgentViewCall(database, fixture) {
  const { classId } = fixture
  const ruleId = await addManualRule(database.client, classId)
  const committed = agentViewEntry(agentApplyRule(fixture, ruleId))
  const rejected = agentViewEntry(adjustment(fixture, 5))
  return withViewRole(database, 'ppt_agent', async (agent) => {
    const { receipts } = await agentSubmitAs(agent, classId, [committed, rejected])
    expect(receipts).toMatchObject([
      { status: 'committed', code: 'OK' }, { status: 'rejected', code: 'FORBIDDEN_ROLE' },
    ])
    return { committed, rejected }
  })
}

async function seedHeldViewCall(database, fixture, oldEntry) {
  const { classId } = fixture
  const heldRuleId = await addManualRule(database.client, classId, 201)
  const heldEntries = makeViewHeldEntries({ ...fixture, heldRuleId })
  const callId = randomUUID()
  const note = '小野批次說明'
  const { receipts } = await withViewRole(database, 'ppt_agent', agent =>
    agentSubmitAs(agent, classId, [heldEntries[0], oldEntry, heldEntries[1]], callId, note),
  )
  expect(receipts).toMatchObject([
    { status: 'held', code: 'HELD_FOR_TEACHER' }, { status: 'committed', replayed: true },
    { status: 'held', code: 'HELD_FOR_TEACHER' },
  ])
  return { heldRuleId, heldEntries, callId, note }
}

export async function addOperationsViewFixture(database) {
  const { client } = database
  const fixture = await addSchoolworkViewFixture(database)
  await setAgentLimits(client, fixture.classId, { max_pending_held: viewMaxPendingHeld })
  const proposal = propose(fixture, 'on_time')
  await commitOperation(client, proposal)
  const agentOps = await seedAgentViewCall(database, fixture)
  const held = await seedHeldViewCall(database, fixture, agentOps.committed)
  return { ...fixture, ...held, proposalId: proposal.op_id, agentOps }
}

export async function revokeViewAuthorization(client, classId) {
  await client.query("DELETE FROM ppt.class_authorizations WHERE class_id = $1 AND actor_kind = 'agent'", [classId])
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
    await revokeViewAuthorization(client, visibleClassId)
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
