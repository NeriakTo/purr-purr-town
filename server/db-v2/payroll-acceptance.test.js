import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import {
  addPayrollJob, assignJob, expectPayrollRejection, payDuty, payrollDay, payrollRows,
  prepareDuty, retireJob, runPayroll, saveJob, setDuty,
} from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function expectActivePayroll(client, { classId, studentIds }, event, amount) {
  const sorted = [...studentIds].sort()
  const payments = await payrollRows(client, classId)
  expect(payments.map(({ student_id }) => student_id).sort()).toEqual(sorted)
  expect(payments.every((payment) => payment.amount === String(amount))).toBe(true)
  const { rows: effects } = await client.query(`
    SELECT student_id, event FROM ppt.effects WHERE class_id = $1 AND status = 'active'
    ORDER BY student_id COLLATE "C"
  `, [classId])
  expect(effects).toEqual(sorted.map((student_id) => ({ student_id, event })))
  const { rows: accounts } = await client.query(`
    SELECT student_id, balance, total_earned FROM ppt.accounts WHERE class_id = $1 ORDER BY student_id COLLATE "C"
  `, [classId])
  expect(accounts).toEqual(sorted.map((student_id) => ({
    student_id, balance: String(amount), total_earned: String(amount),
  })))
}

async function crossClassFixture(client) {
  const [target, other] = [await addClass(client), await addClass(client)]
  target.jobId = await addPayrollJob(client, target.classId, [target.studentId])
  other.jobId = await addPayrollJob(client, other.classId, [other.studentId])
  return { target, other }
}

async function arrangeJobRace(client) {
  const fixture = await addClass(client, { students: ['enrolled', 'home_study'] })
  const jobId = await addPayrollJob(client, fixture.classId, fixture.studentIds)
  return { ...fixture, jobId }
}

function sendJobPayroll({ classId, jobId }) {
  return runPayroll(classId, [jobId])
}

function sendDutyPayroll({ classId }) {
  return payDuty(classId, payrollDay)
}

async function racePayroll(database, arrange, makeOperation, event, amount) {
  const { client, connect } = database
  const workers = await Promise.all([connect(), connect()])
  for (let round = 0; round < 10; round += 1) {
    const fixture = await arrange(client)
    const operations = workers.map(() => makeOperation(fixture))
    expect(operations[0].op_id).not.toBe(operations[1].op_id)
    const receipts = await Promise.all(workers.map((worker, index) => submit(worker, operations[index])))
    expect(receipts).toMatchObject(Array.from({ length: 2 }, () => ({ status: 'committed', code: 'OK', replayed: false })))
    const [winner, duplicate] = [...receipts].sort((a, b) => a.class_seq - b.class_seq)
    expect(winner.result).toMatchObject({ noop: false, skipped: [] })
    expect(winner.result.transactions).toHaveLength(fixture.studentIds.length)
    expect(duplicate.result).toMatchObject({ noop: true, paid: [], transactions: [] })
    expect(duplicate.result.skipped.map(({ student_id, reason }) => [student_id, reason]))
      .toEqual([...fixture.studentIds].sort().map((id) => [id, 'already_paid']))
    await expectActivePayroll(client, fixture, event, amount)
  }
}

describeDatabase('職務、發薪與值日資料庫驗收', () => {
  const database = useTestDatabase()

  it.each([
    ['OP-28 → OP-30', ['normal', 'duty']],
    ['OP-30 → OP-28', ['duty', 'normal']],
  ])('03:383 %s 只從值日入口發一筆', async (_label, order) => {
    const { client } = database()
    const fixture = await prepareDuty(client, { students: ['enrolled'], assigned: [0], roster: [0] })
    const { jobId, studentId } = fixture
    const operations = { normal: sendJobPayroll(fixture), duty: sendDutyPayroll(fixture) }
    for (const kind of order) {
      const receipt = await commitOperation(client, operations[kind])
      if (kind === 'normal') {
        expect(receipt.result).toMatchObject({
          noop: true, paid: [], transactions: [],
          skipped: [{ job_id: jobId, period: null, student_id: null, reason: 'duty_job' }],
        })
      } else {
        expect(receipt.result).toMatchObject({
          noop: false, skipped: [], paid: [{ student_id: studentId, date: payrollDay, amount: 3 }],
        })
        expect(receipt.result.transactions).toHaveLength(1)
      }
    }
    await expectActivePayroll(client, fixture, 'duty_pay', 3)
  })

  it.each([
    ['OP-28 的職務', (a, b) => runPayroll(a.classId, [a.jobId, b.jobId])],
    ['OP-36 的職務', (a, b) => retireJob(a.classId, b.jobId)],
    ['OP-37 的職務', (a, b) => assignJob(a.classId, b.jobId, [a.studentId])],
    ['OP-37 的學生', (a, b) => assignJob(a.classId, a.jobId, [b.studentId], { rev: 2 })],
    ['OP-29 的學生', (a, b) => setDuty(a.classId, payrollDay, [b.studentId])],
    ['OP-43 的值日職務', (a, b) => setSetting(a.classId, 'dutyJobId', b.jobId)],
  ])('%s 只在本班查找，跨班拒絕且不帶 current', async (_label, makeOperation) => {
    const { client } = database()
    const { target, other } = await crossClassFixture(client)
    const before = await classSnapshot(client, other.classId)
    const receipt = await expectPayrollRejection(client, makeOperation(target, other), 'NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
    expect(await classSnapshot(client, other.classId)).toBe(before)
  })

  it('OP-35 可在本班用別班已使用的職務編號新建', async () => {
    const { client } = database()
    const { target, other } = await crossClassFixture(client)
    const before = await classSnapshot(client, other.classId)
    const receipt = await commitOperation(client, saveJob(target.classId, { job_id: other.jobId, title: '本班職務' }))
    expect(receipt.changes).toMatchObject([{ entity: 'job', key: { job_id: other.jobId }, rev: 1, prev_rev: 0 }])
    const { rows } = await client.query('SELECT title FROM ppt.jobs WHERE class_id = $1 AND job_id = $2',
      [target.classId, other.jobId])
    expect(rows).toEqual([{ title: '本班職務' }])
    expect(await classSnapshot(client, other.classId)).toBe(before)
  })

  it.each([
    ['OP-28', arrangeJobRace, sendJobPayroll, 'payroll', 10],
    ['OP-30', prepareDuty, sendDutyPayroll, 'duty_pay', 3],
  ])('%s 兩連線競送十輪，每輪兩筆都成立且只發一輪薪資', async (_label, arrange, makeOperation, event, amount) => {
    await racePayroll(database(), arrange, makeOperation, event, amount)
  }, 15000)
})
