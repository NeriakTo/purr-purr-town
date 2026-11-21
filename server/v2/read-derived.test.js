import { describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { agentSubmit, authorizeAgent } from '../db-v2/test-support/agent.js'
import { addImportedDeduction, addImportedEffect, addImportedSubmission, addImportedTask, resolveLegacyEffect } from '../db-v2/test-support/legacy-effects.js'
import { adjustment, submit } from '../db-v2/test-support/operations.js'
import { addImportedJob, assignJob, runPayroll, saveJob, setCutover } from '../db-v2/test-support/payroll.js'
import { classInfo, updateClassInfo } from '../db-v2/test-support/class-student-group.js'
import { correct } from '../db-v2/test-support/transactions.js'
import { createTestClass, createTestSession, createTestTeacher } from './test-support/fixtures.js'
import { expectNoNeighbor } from './test-support/read-boundaries.js'
import { commitReadOperation } from './test-support/read-entities.js'
import { readJson } from './test-support/read-json.js'
import { sendRead, useReadFixtures } from './test-support/read.js'

async function makeLegacyEffect(client, target, options) {
  const taskId = await addImportedTask(client, target.classId)
  const work = { ...target, taskId }
  await addImportedSubmission(client, work, 'missing')
  return { ...work, effectId: await addImportedEffect(client, work, options) }
}

async function tryLink(client, teacher, effect, transaction_id) {
  await client.query('BEGIN')
  try {
    return await submit(client, resolveLegacyEffect(effect, 'link', { transaction_id }), teacher)
  } finally {
    await client.query('ROLLBACK')
  }
}

async function preparePayrollJobs(client, target, teacher) {
  const jobs = []
  for (const cycle of ['daily', 'weekly', 'monthly', 'semester', 'once']) {
    const op = saveJob(target.classId, { cycle })
    const id = op.payload.job_id
    await commitReadOperation(client, op, teacher)
    await commitReadOperation(client, assignJob(target.classId, id, [target.studentId]), teacher)
    jobs.push(id)
  }
  jobs.push(await addImportedJob(client, target.classId, { assigneeIds: [target.studentId] }))
  return jobs
}

const days = [
  ['2026-11-14T16:30:00Z', '2026-11-15', '2026-W46', '2026-11-09', '2026-11', '2026-11-01', '115-1', '2026-08-01', [false, true, true, true]],
  ['2026-11-14T08:00:00Z', '2026-11-14', '2026-W46', '2026-11-09', '2026-11', '2026-11-01', '115-1', '2026-08-01', [true, true, true, true]],
  ['2027-02-02T08:00:00Z', '2027-02-02', '2027-W05', '2027-02-01', '2027-02', '2027-02-01', '115-2', '2027-02-01', [false, false, false, false]],
  ['2027-01-01T08:00:00Z', '2027-01-01', '2026-W53', '2026-12-28', '2027-01', '2027-01-01', '115-1', '2026-08-01', [false, false, false, true]],
]

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('讀取候選、期別與寫入程序一致', () => {
  const fixture = useReadFixtures()

  test('候選完全符合 OP-53，並以建議優先、日期與編號排序及精確標記理由', async () => {
    const context = fixture()
    const { client, teacher } = context
    const target = await createTestClass(client, { owner: teacher, students: ['enrolled', 'enrolled'] })
    const suggested = await addImportedDeduction(client, target, {
      reason: '作業遲交補記', effectiveAt: '2026-09-03T16:00:00Z',
    })
    const missing = await addImportedDeduction(client, target, { effectiveAt: '2026-08-31T16:00:00Z' })
    const late = await addImportedDeduction(client, target, { reason: '作業遲交', effectiveAt: '2026-08-31T16:00:00Z' })
    const effect = await makeLegacyEffect(client, target, { suggested })
    const positive = await addImportedDeduction(client, target, { amount: 6 })
    const zeroed = await addImportedDeduction(client, target)
    await commitReadOperation(client, correct(target.classId, zeroed, -6, 0), teacher)
    const early = await addImportedDeduction(client, target, { effectiveAt: '2026-08-31T15:59:59Z' })
    const kind = await addImportedDeduction(client, target, { kind: 'adjust' })
    const linked = await addImportedDeduction(client, target)
    await makeLegacyEffect(client, target, { status: 'active', root: linked, event: 'submission.missing' })
    const other = await addImportedDeduction(client, { ...target, studentId: target.studentIds[1] })
    const noDate = await addImportedDeduction(client, target, { effectiveAt: null })
    const nonRoot = await addImportedDeduction(client, target, { root: positive })
    const op = adjustment(target, -6)
    await commitReadOperation(client, op, teacher)
    const fromOp = '測試非匯入根交易'
    await client.query(`
      INSERT INTO ppt.transactions (class_id, student_id, transaction_id, kind, amount, earned_delta,
        occurred_at, effective_at, reason, origin, op_id)
      VALUES ($1, $2, $3, 'legacy_general', -6, -6, '2026-09-10', '2026-09-10', '測試交易', 'op', $4)
    `, [target.classId, target.studentId, fromOp, op.op_id])

    const valid = [suggested, ...[missing, late].sort()]
    const invalid = [positive, zeroed, early, kind, linked, other, noDate, nonRoot, fromOp]
    const { legacy_effects: effects } = await readJson({ ...context, target }, 'state')
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      effect_id: effect.effectId, task_id: effect.taskId, student_id: target.studentId,
      status: 'legacy_unresolved', suggested_transaction_id: suggested,
    })
    expect(effects[0].candidates.map(row => row.transaction_id)).toEqual(valid)
    for (const candidate of effects[0].candidates) {
      const id = candidate.transaction_id
      const reason = id === suggested ? '作業遲交補記' : id === missing ? '作業缺交' : '作業遲交'
      expect(candidate).toEqual({
        transaction_id: id, effective_amount: -6, reason, effective_at: expect.any(String),
        suggested: id === suggested, default_listed: id !== suggested,
      })
      expect(new Date(candidate.effective_at)).toEqual(new Date(id === suggested ? '2026-09-03T16:00:00Z' : '2026-08-31T16:00:00Z'))
    }
    for (const id of valid) expect(await tryLink(client, teacher, effect, id), id).toMatchObject({ status: 'committed' })
    for (const id of invalid) expect(await tryLink(client, teacher, effect, id), id).toMatchObject({ code: 'TX_NOT_REVERSIBLE' })
  })

  test('OP-53 裁決的繳交附已裁決效果，並重算同學生其他繳交的候選', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const transactionId = await addImportedDeduction(client, target)
    const first = await makeLegacyEffect(client, target, { suggested: transactionId })
    const second = await makeLegacyEffect(client, target)
    const seed = await commitReadOperation(client, adjustment(target, 1), teacher)
    const before = await readJson(context, 'state')
    expect(before.legacy_effects).toHaveLength(2)
    for (const effect of before.legacy_effects) {
      expect(effect.candidates.map(row => row.transaction_id)).toEqual([transactionId])
    }
    await commitReadOperation(client, resolveLegacyEffect(first, 'link', { transaction_id: transactionId }), teacher)
    const result = await readJson(context, 'changes', { since_seq: seed.class_seq })
    expect(result.full).toBe(false)
    expect(result.legacy_effects).toHaveLength(2)
    expect(result.legacy_effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect_id: first.effectId, status: 'active', candidates: [] }),
      expect.objectContaining({ effect_id: second.effectId, status: 'legacy_unresolved', candidates: [] }),
    ]))
  })

  test('只有交易更正時亦重帶歷史效果候選，沖為零後不再列入', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const transactionId = await addImportedDeduction(client, target)
    const effect = await makeLegacyEffect(client, target)
    const seed = await commitReadOperation(client, adjustment(target, 1), teacher)
    await commitReadOperation(client, correct(target.classId, transactionId, -6, 0), teacher)
    const result = await readJson(context, 'changes', { since_seq: seed.class_seq })
    expect(result.rows.some(row => row.entity === 'submission')).toBe(false)
    expect(result.legacy_effects).toMatchObject([{ effect_id: effect.effectId, candidates: [] }])
  })

  test('只有效果接到新序號時，以建立及沖回操作重帶該學生未裁決效果', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const root = await addImportedDeduction(client, target)
    const unresolved = await makeLegacyEffect(client, target)
    const linked = await makeLegacyEffect(client, target, { status: 'active', root, event: 'submission.missing' })
    const seed = await commitReadOperation(client, adjustment(target, 1), teacher)
    let since_seq = seed.class_seq
    for (const column of ['created_op_id', 'reversed_op_id']) {
      // 此夾具只接效果的序號，讓其他觸發條件無法掩蓋漏列。
      const op = updateClassInfo(target.classId, { ...classInfo, name: '測試班級' + column }, { rev: since_seq })
      const receipt = await commitReadOperation(client, op, teacher)
      await client.query(`
        UPDATE ppt.effects SET ${column} = $3 WHERE class_id = $1 AND effect_id = $2
      `, [target.classId, linked.effectId, op.op_id])
      const result = await readJson(context, 'changes', { since_seq })
      expect(result.transactions).toEqual([])
      expect(result.rows.map(row => row.entity)).toEqual(['class'])
      expect(result.legacy_effects).toMatchObject([{ effect_id: unresolved.effectId, candidates: [] }])
      since_seq = receipt.class_seq
    }
  })

  test('同班限定涵蓋與鄰班重用編號的作業、候選、更正鏈與關聯效果', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const root = await addImportedDeduction(client, target)
    const effect = await makeLegacyEffect(client, target)
    const before = await readJson(context, 'state')
    expect(before.legacy_effects).toMatchObject([{ candidates: [{ transaction_id: root, effective_amount: -6 }] }])
    const neighbor = await createTestClass(client, { owner: teacher, students: [] })
    await client.query(`
      INSERT INTO ppt.students (class_id, student_id, seat_number, name, enrollment_status)
      VALUES ($1, $2, 1, '測試鄰班學生', 'enrolled')
    `, [neighbor.classId, target.studentId])
    await client.query('INSERT INTO ppt.accounts (class_id, student_id) VALUES ($1, $2)', [neighbor.classId, target.studentId])
    const duplicate = { ...neighbor, studentId: target.studentId, taskId: effect.taskId }
    await client.query(`
      INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester)
      VALUES ($1, $2, '測試鄰班作業', '作業', '2026-08-01', '2026-09-01', '115-1')
    `, [neighbor.classId, duplicate.taskId])
    await client.query(`
      INSERT INTO ppt.transactions (class_id, student_id, transaction_id, kind, amount, earned_delta,
        origin, batch_id, reason, occurred_at, effective_at, root_transaction_id)
      VALUES
        ($1, $2, $3, 'legacy_general', -6, -6, 'migration', '測試批次', '測試鄰班交易', '2026-09-10', '2026-09-10', NULL),
        ($1, $2, $4, 'correction', 6, 6, 'migration', '測試批次', '測試鄰班更正', '2026-09-11', '2026-09-11', $3)
    `, [neighbor.classId, duplicate.studentId, root, randomUUID()])
    await addImportedDeduction(client, duplicate)
    await addImportedEffect(client, duplicate, { status: 'active', event: 'submission.missing', root })
    const after = await readJson(context, 'state')
    expect(after.legacy_effects).toEqual(before.legacy_effects)
  })

  test.each(days)('臺灣期別與 OP-28 在 %s 對同一批職務的判定相同',
    async (instant, pay_date, week, weekStart, month, monthStart, semester, semesterStart, flags) => {
      const context = fixture()
      const { client, target, teacher } = context
      const app = context.makeApp({ clock: () => new Date(instant) })
      const token = await createTestSession(client, teacher.id, { expiresAt: new Date('2027-03-01') })
      await setCutover(client, target.classId, '2026-11-15')
      const jobs = await preparePayrollJobs(client, target, teacher)
      const { payroll } = await readJson(context, 'state', {}, { app, token })
      expect(payroll).toHaveLength(6)
      const periods = [pay_date, week, month, semester, 'once', 'once']
      const firstDays = [pay_date, weekStart, monthStart, semesterStart, null, null]
      const warnings = [...flags, false, true]
      const byId = new Map(payroll.map(row => [row.job_id, row]))
      for (const [index, job_id] of jobs.entries()) {
        expect(byId.get(job_id)).toEqual({
          job_id, pay_date, period: periods[index], first_day: firstDays[index],
          needs_legacy_confirmation: warnings[index],
        })
      }
      const { result } = await commitReadOperation(client, runPayroll(target.classId, jobs, { pay_date }), teacher)
      expect(result.skipped.map(({ job_id, period, reason }) => ({ job_id, period, reason }))).toEqual(
        jobs.flatMap((job_id, index) => byId.get(job_id).needs_legacy_confirmation
          ? [{ job_id, period: periods[index], reason: 'legacy_period' }] : []),
      )
      expect(result.paid.map(({ job_id, period }) => ({ job_id, period }))).toEqual(
        jobs.flatMap((job_id, index) => byId.get(job_id).needs_legacy_confirmation ? [] : [{ job_id, period: periods[index] }]),
      )
    })

  test('沒有新操作的增量在臺灣午夜更新發薪日並仍帶批次，序號零也帶衍生欄位', async () => {
    const context = fixture()
    const { client, teacher, target } = context
    const job = saveJob(target.classId, { cycle: 'daily' })
    const receipt = await commitReadOperation(client, job, teacher)
    await authorizeAgent(client, target.classId)
    const batch = await agentSubmit(client, target.classId, [adjustment(target)], undefined, '測試讀取批次')
    // 無論測試在哪天執行，固定批次時間與兩次讀取得到相同的時間關係。
    await client.query('UPDATE ppt.agent_calls SET created_at = $2 WHERE call_id = $1', [batch.call_id, '2026-11-14T14:00:00Z'])
    const since_seq = (await readJson(context, 'state')).class_seq
    expect(since_seq).toBeGreaterThanOrEqual(receipt.class_seq)
    let instant = '2026-11-14T15:59:59Z'
    const app = context.makeApp({ clock: () => new Date(instant) })
    const before = await readJson(context, 'changes', { since_seq }, { app })
    instant = '2026-11-14T16:00:00Z'
    const after = await readJson(context, 'changes', { since_seq }, { app })
    expect(before.payroll).toMatchObject([{ pay_date: '2026-11-14', needs_legacy_confirmation: false }])
    expect(after).toMatchObject({ class_seq: since_seq, full: false, rows: [], operations: [], transactions: [] })
    expect(after.payroll).toMatchObject([{ pay_date: '2026-11-15' }])
    expect(before.agent_batches).toMatchObject([{ batch_id: batch.call_id }])
    expect(after.agent_batches).toEqual(before.agent_batches)
    expect(await readJson(context, 'changes', { since_seq: 0 }, { app })).toEqual({
      ...await readJson(context, 'state', {}, { app }), full: true,
    })
  })

  test.each([['別的老師', false], ['同一位老師', true]])('%s 的另一班不會混入衍生資料', async (_label, sameOwner) => {
    const context = fixture()
    const { client, target, teacher } = context
    const receipt = await commitReadOperation(client, adjustment(target), teacher)
    const makeRequests = () => Promise.all([
      sendRead(context, 'state', { class_id: target.classId }),
      sendRead(context, 'changes', { class_id: target.classId, since_seq: receipt.class_seq }),
    ])
    const before = await makeRequests()
    const neighborTeacher = sameOwner ? teacher : createTestTeacher()
    const neighbor = await createTestClass(client, { owner: neighborTeacher })
    await addImportedDeduction(client, neighbor)
    await makeLegacyEffect(client, neighbor)
    await addImportedJob(client, neighbor.classId)
    await authorizeAgent(client, neighbor.classId)
    const batch = await agentSubmit(client, neighbor.classId, [adjustment(neighbor)], undefined, 'OTHER-CLASS-MARKER-7f3a')
    await client.query('UPDATE ppt.agent_calls SET created_at = $2 WHERE call_id = $1', [batch.call_id, '2026-11-22T07:00:00Z'])
    const after = await makeRequests()
    for (const [index, response] of after.entries()) {
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ legacy_effects: [], payroll: [], agent_batches: [] })
      expectNoNeighbor(response, neighbor)
      expect(response.body).toEqual(before[index].body)
    }
  })
})
