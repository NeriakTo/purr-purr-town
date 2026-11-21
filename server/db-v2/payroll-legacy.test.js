import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass } from './test-support/operations.js'
import {
  addImportedJob, addPayrollJob, assignJob, expectPayrollRejection, payrollRows, runPayroll, setCutover,
} from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const cutover = '2026-11-15'
const monthlyDate = '2026-11-20'

async function addLegacyClass(client, students = ['enrolled', 'enrolled'], cutoverDate = cutover) {
  const fixture = await addClass(client, { students })
  await setCutover(client, fixture.classId, cutoverDate)
  return fixture
}

function skippedJob(job_id, period, reason = 'legacy_period', student_id = null) {
  return { job_id, period, student_id, reason }
}

async function expectSkippedPayroll(client, classId, op, skipped) {
  const before = await classSnapshot(client, classId, { ignoreClassSequence: true })
  const receipt = await commitOperation(client, op)
  expect(receipt.changes).toEqual([])
  expect(receipt.result).toMatchObject({ noop: true, transactions: [], paid: [], skipped })
  expect(await classSnapshot(client, classId, { ignoreClassSequence: true })).toBe(before)
}

describeDatabase('跨切換日的一般發薪 OP-28', () => {
  const database = useTestDatabase()

  it('03:384 月中切換，當月需確認且下月照發', async () => {
    const { client } = database()
    const { classId, studentIds } = await addLegacyClass(client)
    const jobId = await addPayrollJob(client, classId, studentIds)
    await expectSkippedPayroll(client, classId, runPayroll(classId, [jobId], { pay_date: monthlyDate }),
      [skippedJob(jobId, '2026-11')])
    const confirmed = await commitOperation(client, runPayroll(classId, [jobId], {
      pay_date: monthlyDate, include_legacy_periods: true,
    }))
    expect(confirmed.result.paid.map((item) => item.student_id)).toEqual([...studentIds].sort())
    expect(confirmed.result.skipped).toEqual([])
    const next = await addLegacyClass(client)
    const nextJob = await addPayrollJob(client, next.classId, next.studentIds)
    const later = await commitOperation(client, runPayroll(next.classId, [nextJob], { pay_date: '2026-12-05' }))
    expect(later.result.paid.map((item) => item.student_id)).toEqual([...next.studentIds].sort())
    expect(later.result.skipped).toEqual([])
  })

  it.each([
    ['daily', '2026-11-14', '2026-11-14', true], ['daily', '2026-11-15', '2026-11-15', false],
    ['weekly', '2026-11-15', '2026-W46', true], ['weekly', '2026-11-16', '2026-W47', false],
    ['semester', '2026-11-20', '115-1', true], ['semester', '2027-02-10', '115-2', false],
  ])('%s 週期在 %s 依 %s 的第一天判斷', async (cycle, pay_date, period, legacy) => {
    const { client } = database()
    const { classId, studentIds } = await addLegacyClass(client)
    const jobId = await addPayrollJob(client, classId, studentIds, { cycle })
    const receipt = await commitOperation(client, runPayroll(classId, [jobId], { pay_date }))
    expect(receipt.result.skipped).toEqual(legacy ? [skippedJob(jobId, period)] : [])
    expect(receipt.result.transactions).toHaveLength(legacy ? 0 : 2)
  })

  it.each([cutover, null])('一次性職務依來源判斷，班級切換日為 %s', async (cutoverDate) => {
    const { client } = database()
    const { classId, studentIds } = await addLegacyClass(client, ['enrolled'], cutoverDate)
    const imported = await addImportedJob(client, classId, { assigneeIds: studentIds })
    const created = await addPayrollJob(client, classId, studentIds, { cycle: 'once' })
    const receipt = await commitOperation(client, runPayroll(classId, [imported, created], { pay_date: monthlyDate }))
    expect(receipt.result.skipped).toEqual([skippedJob(imported, 'once')])
    expect(receipt.result.paid).toMatchObject([{ job_id: created, period: 'once' }])
    const confirmed = await commitOperation(client, runPayroll(classId, [imported], {
      pay_date: monthlyDate, include_legacy_periods: true,
    }))
    expect(confirmed.result.paid).toMatchObject([{ job_id: imported, period: 'once' }])
  })

  it('沒有切換日的月薪，一樣可以有旗標或省略', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client)
    const jobIds = await Promise.all([1, 2].map(() => addPayrollJob(client, classId, studentIds)))
    for (const [index, fields] of [{}, { include_legacy_periods: true }].entries()) {
      const receipt = await commitOperation(client, runPayroll(classId, [jobIds[index]], { pay_date: monthlyDate, ...fields }))
      expect(receipt.result).toMatchObject({ skipped: [], paid: [{ period: '2026-11', amount: 10 }] })
    }
  })

  it('帶旗標發完後，同一期新操作一律逐人列已發', async () => {
    const { client } = database()
    const { classId, studentIds } = await addLegacyClass(client)
    const jobId = await addPayrollJob(client, classId, studentIds)
    await commitOperation(client, runPayroll(classId, [jobId], { pay_date: monthlyDate, include_legacy_periods: true }))
    for (const fields of [{}, { include_legacy_periods: true }]) {
      await expectSkippedPayroll(client, classId, runPayroll(classId, [jobId], { pay_date: monthlyDate, ...fields }),
        [...studentIds].sort().map((id) => skippedJob(jobId, '2026-11', 'already_paid', id)))
    }
  })

  it('部分已發先列學生，再列職務，false 與省略一致並拒絕非布林旗標', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second, transferred, archived] } = await addLegacyClass(client,
      ['enrolled', 'home_study', 'transferred', 'archived'])
    const jobId = await addPayrollJob(client, classId, [first])
    await commitOperation(client, runPayroll(classId, [jobId], { pay_date: monthlyDate, include_legacy_periods: true }))
    await commitOperation(client, assignJob(classId, jobId, [second, transferred, first, archived], { rev: 2 }))
    for (const fields of [{}, { include_legacy_periods: false }]) {
      await expectSkippedPayroll(client, classId, runPayroll(classId, [jobId], { pay_date: monthlyDate, ...fields }),
        [skippedJob(jobId, '2026-11', 'already_paid', first), skippedJob(jobId, '2026-11')])
    }
    await expectPayrollRejection(client, runPayroll(classId, [jobId], {
      pay_date: monthlyDate, include_legacy_periods: 'true',
    }), 'INVALID_PAYLOAD')
    expect(await payrollRows(client, classId)).toHaveLength(1)
  })

  it('同批只發當期日薪，零薪資和無合格學生的跨切換日職務不列', async () => {
    const { client } = database()
    const { classId, studentIds: [student, transferred] } = await addLegacyClass(client, ['enrolled', 'transferred'])
    const legacy = await addPayrollJob(client, classId, [student])
    const daily = await addPayrollJob(client, classId, [student], { cycle: 'daily' })
    const zero = await addPayrollJob(client, classId, [student], { salary: 0 })
    const inactive = await addPayrollJob(client, classId, [transferred])
    const receipt = await commitOperation(client, runPayroll(classId, [legacy, daily, zero, inactive], {
      pay_date: monthlyDate,
    }))
    expect(receipt.result).toMatchObject({
      noop: false, skipped: [skippedJob(legacy, '2026-11')], paid: [{ job_id: daily, student_id: student }],
    })
  })
})
