import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { authorizeAgent } from './test-support/agent.js'
import { agentApplyRule } from './test-support/agent-fixtures.js'
import {
  listAgentViews, maskedColumns, quoteViewName, setViewStudentNames, withViewRole,
} from './test-support/agent-views.js'
import { saveAnnouncement, saveSeating } from './test-support/announcement-seating.js'
import { classInfo, saveGroup, updateClassInfo } from './test-support/class-student-group.js'
import { saveComment } from './test-support/comments.js'
import { confirm } from './test-support/confirmations.js'
import { changeRound, requireRound } from './test-support/correction-rounds.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { assignJob, saveJob, setDuty } from './test-support/payroll.js'
import { saveProduct } from './test-support/products.js'
import { agentSubmitAs } from './test-support/roles.js'
import { createTask, saveRule } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { undo } from './test-support/undo.js'

const markers = {
  studentName: '姓名記號甲', comment: '評語記號甲', motto: '箴言記號甲', observation: '觀察記號甲',
  announcement: '公告記號甲', seating: '座位表記號甲', reason: '交易理由記號甲',
  teacherName: '導師姓名記號乙', className: '班名記號甲', teacherId: '老師編號記號甲',
  productName: '商品記號甲', setting: '設定記號甲', teacherNote: '姓名記號甲訂正',
}
const teacher = { kind: 'teacher', id: markers.teacherId }

// Explicit per-view entries keep new text columns subject to review even when their names recur.
const identifiersAndEnums = {
  classes: { ids: ['class_id'], enums: ['status'] },
  students: { ids: ['class_id', 'student_id'], enums: ['enrollment_status'] },
  groups: { ids: ['class_id', 'leader_student_id'] },
  accounts: { ids: ['class_id', 'student_id'] },
  transactions: {
    ids: ['class_id', 'transaction_id', 'student_id', 'rule_id', 'root_transaction_id', 'op_id'],
    enums: ['kind', 'semester'],
  },
  rules: { ids: ['class_id', 'rule_id'], enums: ['kind', 'event'] },
  rule_versions: { ids: ['class_id', 'rule_id'] },
  tasks: { ids: ['class_id', 'task_id'], enums: ['semester'] },
  submissions: { ids: ['class_id', 'task_id', 'student_id', 'last_op_id'], enums: ['status'] },
  corrections: { ids: ['class_id', 'correction_id', 'task_id', 'student_id'], enums: ['status'] },
  jobs: { ids: ['class_id', 'job_id'], enums: ['cycle'] },
  job_assignees: { ids: ['class_id', 'job_id', 'student_id'] },
  daily_duties: { ids: ['class_id', 'student_id'] },
  confirmations: {
    ids: ['class_id', 'confirmation_id', 'task_id', 'student_id', 'batch_id'],
    enums: ['kind', 'status', 'proposed_status', 'held_reason'],
  },
  held_batches: {
    ids: ['class_id', 'confirmation_id', 'batch_id'], enums: ['status', 'held_reason'],
    own: {
      note: '小野呼叫時輸入的說明',
      held_inputs: '小野提交暫緩批次的原始項目',
      items: '批次成員的操作編號、結果列舉與小野收據，收據由記號掃描覆蓋',
    },
  },
  operations: {
    ids: ['class_id', 'op_id', 'batch_id'], enums: ['actor_kind', 'type', 'status', 'code'],
    own: {
      payload: '小野自己的操作輸入，其他操作者的欄位為空值',
      expect: '小野自己的版本條件，其他操作者的欄位為空值',
      receipt: '小野自己的收據，由記號掃描覆蓋',
    },
  },
  agent_calls: {
    ids: ['class_id', 'call_id'],
    own: {
      note: '小野呼叫時輸入的說明',
      entries: '每項只有操作編號與布林旗標',
      held_inputs: '小野自己提交的暫緩輸入',
    },
  },
}

function registeredTextColumns() {
  return Object.entries(identifiersAndEnums).flatMap(([view, { ids = [], enums = [], own = {} }]) =>
    [
      // IDs are structured references. Enums include the validated academic term format.
      ...ids, ...enums, ...Object.keys(own), ...Object.keys(maskedColumns[view] ?? {}),
    ].map(column => view + '.' + column),
  ).sort()
}

async function catalogTextColumns(agent) {
  const { rows } = await agent.query(`
    SELECT c.relname || '.' || a.attname AS field
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = 'ppt_agent' AND c.relkind = 'v'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND (t.typcategory = 'S' OR t.typname IN ('json', 'jsonb'))
  `)
  return rows.map(row => row.field).sort()
}

async function assertTeacherCommit(web, op) {
  const receipt = await submit(web, op, teacher)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

async function seedMarkerRecords(web, fixture) {
  const { classId } = fixture
  const adjust = adjustment(fixture, 20)
  adjust.payload.reason = markers.reason
  const rule = saveRule(classId, { name: markers.studentName + '加分' })
  const task = createTask(classId, { title: markers.studentName + '作業' })
  const target = { ...fixture, taskId: task.payload.task_id }
  const correction = requireRound(target, { note: markers.teacherNote })
  const job = saveJob(classId)
  const operations = [
    updateClassInfo(classId, { ...classInfo, name: markers.className, teacher_name: markers.teacherName }),
    saveComment(target, { observation: markers.observation, comment: markers.comment, motto: markers.motto }),
    saveAnnouncement(classId, { text: markers.announcement }),
    saveSeating(classId, { custom_objects: [{ id: markers.seating }] }),
    adjust, saveProduct(classId, { name: markers.productName }),
    setSetting(classId, 'taskTypes', [markers.setting]), rule, task, correction,
    setSetting(classId, 'agentLimits', {
      max_students_per_call: 1, max_students_per_10min: 10, max_points_per_tx: 200,
      max_points_per_student_per_day: 300, max_pending_held: 5,
    }),
    saveGroup(classId), job, assignJob(classId, job.payload.job_id, [fixture.studentId]),
    setDuty(classId, '2026-11-22', [fixture.studentId]),
  ]
  for (const operation of operations) await assertTeacherCommit(web, operation)
  return { ...target, ruleId: rule.payload.rule_id, correctionId: correction.payload.correction_id }
}

function expectMarkerFree(value, path) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  for (const marker of Object.values(markers)) expect(serialized, path + '｜' + marker).not.toContain(marker)
}

async function scanViewRows(agent, stage) {
  for (const view of await listAgentViews(agent)) {
    const { rows } = await agent.query('SELECT row_to_json(v)::text AS body FROM ' + quoteViewName(view) + ' v')
    if (stage !== '小野操作前') expect(rows.length, stage + '｜' + view).toBeGreaterThan(0)
    for (const { body } of rows) expectMarkerFree(body, stage + '｜' + view)
  }
}

function markerEntry(op) {
  const { class_id: _classId, ...entry } = op
  return entry
}

async function commitAgentMarkerOperation(agent, op) {
  const batch = await agentSubmitAs(agent, op.class_id, [markerEntry(op)])
  expect(batch.receipts).toMatchObject([{ op_id: op.op_id, status: 'committed', code: 'OK' }])
  expectMarkerFree(batch, '呼叫收據｜' + op.type)
}

async function exerciseMarkerOperations(agent, target) {
  const { classId, studentIds, correctionId, ruleId } = target
  await commitAgentMarkerOperation(agent, requireRound({ ...target, studentId: studentIds[1] }, { note: '練習題一' }))
  await commitAgentMarkerOperation(agent, changeRound({ classId, correctionId }, 'mark_returned', { rev: 1 }))
  const applied = agentApplyRule(target, ruleId)
  await commitAgentMarkerOperation(agent, applied)
  await commitAgentMarkerOperation(agent, undo(classId, applied.op_id))
}

async function scanHeldMarkerBatch(agent, web, target) {
  const { classId, studentIds } = target
  const targets = studentIds.slice(2).map(studentId => ({ ...target, studentId }))
  const entries = targets.map(student => markerEntry(setStatus(student, 'missing')))
  const callId = randomUUID()
  const held = await agentSubmitAs(agent, classId, entries, callId)
  expect(held.receipts).toMatchObject(entries.map(({ op_id }) => ({ op_id, status: 'held', code: 'HELD_FOR_TEACHER' })))
  expectMarkerFree(held, '暫緩收據')
  await scanViewRows(agent, '暫緩期間')
  const latest = await assertTeacherCommit(web, setStatus(targets[0], 'on_time'))
  await assertTeacherCommit(web, confirm(classId, entries[0].op_id))
  const replay = await agentSubmitAs(agent, classId, entries, callId)
  expect(replay.call_id).toBe(callId)
  expect(replay.receipts).toMatchObject([
    {
      op_id: entries[0].op_id, replayed: true, status: 'rejected', code: 'STALE_STATE',
      current: { last_op_id: latest.op_id, actor: { kind: 'teacher' } },
    },
    { op_id: entries[1].op_id, replayed: true, status: 'committed', code: 'OK' },
  ])
  expect(replay.receipts[0].current.actor).toEqual({ kind: 'teacher' })
  expectMarkerFree(replay, '確認後同呼叫重送收據')
  await scanViewRows(agent, '確認後同呼叫重送')
}

describeDatabase('小野檢視表的記號掃描與文字欄位登記', () => {
  const database = useTestDatabase()

  it('X15 與 X24 五種操作與暫緩確認重送前後，所有檢視表和收據都找不到記號', async () => {
    const { client } = database()
    const fixture = await addClass(client, { owner: teacher, students: Array(4).fill('enrolled') })
    await setViewStudentNames(client, fixture, [markers.studentName, '陳大文', '歐陽小華', '司馬大中'])
    await authorizeAgent(client, fixture.classId)
    await withViewRole(database(), 'ppt_web', async (web) => {
      const target = await seedMarkerRecords(web, fixture)
      await withViewRole(database(), 'ppt_agent', async (agent) => {
        await scanViewRows(agent, '小野操作前')
        await exerciseMarkerOperations(agent, target)
        await scanHeldMarkerBatch(agent, web, target)
      })
    })
  })

  it('系統目錄的每個文字與 JSON 欄位都有逐欄登記', async () => {
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      expect(await catalogTextColumns(agent)).toEqual(registeredTextColumns())
    })
  })
})
