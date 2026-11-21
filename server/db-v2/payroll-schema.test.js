import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { addImportedJob, payrollDay } from './test-support/payroll.js'
import { commitOperation, saveRule } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function insertDuty(client, classId, students) {
  return client.query('INSERT INTO ppt.daily_duties (class_id, duty_date, student_ids) VALUES ($1, $2, $3)',
    [classId, payrollDay, JSON.stringify(students)])
}

async function insertPayrollEffect(client, target, receipt, event, kind, key) {
  const effectId = randomUUID()
  const { rows: [effect] } = await client.query(`
    INSERT INTO ppt.effects (class_id, student_id, effect_id, lineage_id, event, subject_kind, subject_key,
      root_transaction_id, status, origin, created_op_id)
    VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'active', 'op', $8)
    RETURNING event, rule_id, rule_rev
  `, [target.classId, target.studentId, effectId, event, kind, key, receipt.result.transactions[0], receipt.op_id])
  return effect
}

describeDatabase('職務與發薪資料表', () => {
  const database = useTestDatabase()

  it('班級預設沒有切換日，職務接受轉換編號及來源', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const jobId = await addImportedJob(client, classId, { assigneeIds: [studentId] })
    expect(jobId).toMatch(/^[a-f0-9]{64}$/)
    const { rows: [job] } = await client.query('SELECT * FROM ppt.jobs WHERE class_id = $1 AND job_id = $2', [classId, jobId])
    expect(job).toMatchObject({ origin: 'migration', rev: 1, last_op_id: null, assignee_ids: [studentId] })
    const { rows } = await client.query('SELECT cutover_date FROM ppt.classes WHERE class_id = $1', [classId])
    expect(rows).toEqual([{ cutover_date: null }])
  })

  it.each([
    ['週期', { cycle: 'yearly' }], ['來源', { origin: 'legacy' }], ['指派名單', { assigneeIds: {} }],
  ])('限制職務的%s', async (_label, fields) => {
    const { client } = database()
    const { classId } = await addClass(client)
    await expect(addImportedJob(client, classId, fields)).rejects.toMatchObject({ code: '23514' })
  })

  it('值日名單必須是陣列且同班同日只有一列', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await expect(insertDuty(client, classId, {})).rejects.toMatchObject({ code: '23514' })
    await insertDuty(client, classId, [studentId])
    await expect(insertDuty(client, classId, [])).rejects.toMatchObject({ code: '23505' })
  })

  it('效果接受兩種薪資事件並限制同一學生同一期', async () => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await commitOperation(client, adjustment(target, 1))
    const jobId = randomUUID()
    const put = (period) => insertPayrollEffect(client, target, receipt, 'payroll', 'job_period', jobId + '|' + period)
    expect(await put('2026-12')).toEqual({ event: 'payroll', rule_id: null, rule_rev: null })
    expect(await insertPayrollEffect(client, target, receipt, 'duty_pay', 'date', payrollDay))
      .toEqual({ event: 'duty_pay', rule_id: null, rule_rev: null })
    await expect(put('2026-12')).rejects.toMatchObject({ code: '23505', constraint: 'effects_one_active_target' })
    await put('2027-01')
  })

  it.each(['payroll', 'duty_pay'])('OP-38 拒絕薪資事件 %s', async (event) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const before = await classSnapshot(client, classId)
    const receipt = await submit(client, saveRule(classId, { kind: 'event', event }))
    expect(receipt).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
    expect(await classSnapshot(client, classId)).toBe(before)
  })

  it('規則表拒絕直接建立薪資事件規則', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    await expect(client.query(`
      INSERT INTO ppt.rules (class_id, rule_id, kind, event) VALUES ($1, $2, 'event', 'payroll')
    `, [classId, randomUUID()])).rejects.toMatchObject({ code: '23514' })
  })

  it('OP-38 仍接受原本五種事件', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const events = ['submission.late', 'submission.missing', 'daily_quest.complete', 'correction.confirmed', 'correction.overdue']
    for (const event of events) await commitOperation(client, saveRule(classId, { kind: 'event', event }))
    const { rows } = await client.query('SELECT event FROM ppt.rules WHERE class_id = $1 ORDER BY event', [classId])
    expect(rows.map(({ event }) => event)).toEqual(events)
  })

  it('班級快照會隨職務列和值日列各自變更', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await addImportedJob(client, classId)
    await insertDuty(client, classId, [])
    const original = await classSnapshot(client, classId)
    await client.query('UPDATE ppt.jobs SET salary = 20 WHERE class_id = $1', [classId])
    const afterJob = await classSnapshot(client, classId)
    expect(afterJob).not.toBe(original)
    await client.query('UPDATE ppt.daily_duties SET student_ids = $2 WHERE class_id = $1', [classId, JSON.stringify([studentId])])
    expect(await classSnapshot(client, classId)).not.toBe(afterJob)
  })
})
