import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { balanceOf } from './test-support/submission-flow.js'
import { addClass, submit } from './test-support/operations.js'
import { addPayrollJob, payrollDay, payrollRows, runPayroll, saveJob } from './test-support/payroll.js'
import { assignJob, expectPayrollRejection, expectPayrollRole } from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'

describeDatabase('一般發薪 OP-28', () => {
  const database = useTestDatabase()

  it('照職務與學生順序發四筆，效果和帳戶收據與帳本一致', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second, third] } = await addClass(client, { students: Array(3).fill('enrolled') })
    const monthly = await addPayrollJob(client, classId, [second, first])
    const weekly = await addPayrollJob(client, classId, [third, second], { salary: 5, cycle: 'weekly', title: '衛生股長' })
    const jobIds = [monthly, weekly]
    const receipt = await commitOperation(client, runPayroll(classId, jobIds))
    const expected = jobIds.flatMap((job_id, index) => {
      const [period, amount, title, students] = index === 0
        ? ['2026-12', 10, '圖書股長', [first, second]] : ['2026-W50', 5, '衛生股長', [second, third]]
      return students.sort().map((student_id) => ({ job_id, period, amount, title, student_id }))
    })
    expect(receipt.result).toMatchObject({ skipped: [], effects_reversed: [], noop: false })
    expect(receipt.warnings).toEqual([])
    expect(receipt.result.transactions).toHaveLength(4)
    expect(receipt.result.effects_added).toHaveLength(4)
    expect(receipt.result.paid).toHaveLength(4)
    for (const [index, { job_id, period, amount, title, student_id }] of expected.entries()) {
      const transaction_id = receipt.result.transactions[index]
      const tx = await transactionFrom(client, receipt, index)
      expect(tx).toMatchObject({
        transaction_id, student_id, kind: 'payroll', amount: String(amount), earned_delta: String(amount),
        occurred_at: new Date(receipt.committed_at), effective_at: new Date(receipt.committed_at),
        reason: title + ' 薪資 (' + period + ')', rule_id: null, rule_rev: null,
      })
      expect(receipt.result.paid[index]).toEqual({ job_id, period, student_id, transaction_id, amount })
      const effect = receipt.result.effects_added[index]
      expect(effect).toEqual({
        event: 'payroll', subject_kind: 'job_period', subject_key: job_id + '|' + period, amount,
        root_transaction_id: transaction_id, effect_id: effect.effect_id, lineage_id: effect.effect_id,
      })
      const { rows } = await client.query('SELECT * FROM ppt.effects WHERE class_id = $1 AND effect_id = $2',
        [classId, effect.effect_id])
      expect(rows).toMatchObject([{
        student_id, event: 'payroll', subject_kind: 'job_period', subject_key: job_id + '|' + period,
        root_transaction_id: transaction_id, status: 'active', origin: 'op', lineage_id: effect.effect_id,
        rule_id: null, rule_rev: null, created_op_id: receipt.op_id,
      }])
    }
    expect(receipt.changes.map(({ key: { student_id } }) => student_id)).toEqual([first, second, third].sort())
    expect(receipt.changes.find(({ key }) => key.student_id === second)).toMatchObject({
      entity: 'account', prev_rev: 1, rev: 3, prev_value: { balance: 0, total_earned: 0 },
      value: { balance: 15, total_earned: 15 },
    })
  })

  it.each([
    ['daily', payrollDay, payrollDay], ['weekly', '2026-11-21', '2026-W47'], ['weekly', '2027-01-01', '2026-W53'],
    ['monthly', '2026-12-31', '2026-12'], ['semester', '2027-01-15', '115-1'], ['semester', '2027-02-01', '115-2'],
    ['once', '2027-02-01', 'once'],
  ])('%s 週期在 %s 對應 %s', async (cycle, pay_date, period) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const jobId = await addPayrollJob(client, classId, [studentId], { cycle })
    const receipt = await commitOperation(client, runPayroll(classId, [jobId], { pay_date }))
    expect(receipt.result).toMatchObject({ paid: [{ period }], effects_added: [{ subject_key: jobId + '|' + period }] })
  })

  it('同一期跳過已發者、補發新指派學生，下個月兩位都發', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second] } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const jobId = await addPayrollJob(client, classId, [first])
    await commitOperation(client, runPayroll(classId, [jobId]))
    for (const pay_date of [payrollDay, '2026-12-31']) {
      const repeated = await commitOperation(client, runPayroll(classId, [jobId], { pay_date }))
      expect(repeated).toMatchObject({ changes: [], result: { noop: true, paid: [], transactions: [],
        skipped: [{ job_id: jobId, period: '2026-12', student_id: first, reason: 'already_paid' }] } })
      expect(await balanceOf(client, { classId, studentId: first })).toBe(10)
    }
    await commitOperation(client, assignJob(classId, jobId, [first, second], { rev: 2 }))
    const added = await commitOperation(client, runPayroll(classId, [jobId]))
    expect(added.result).toMatchObject({ paid: [{ student_id: second }], skipped: [{ student_id: first }] })
    const next = await commitOperation(client, runPayroll(classId, [jobId], { pay_date: '2027-01-08' }))
    expect(next.result.paid).toHaveLength(2)
  })

  it.each([
    ['停用職務', 'enrolled', { retired: true }, false], ['零薪資', 'enrolled', { salary: 0 }, false],
    ['轉出', 'transferred', {}, false], ['封存', 'archived', {}, false], ['在家自學', 'home_study', {}, true],
  ])('發薪範圍處理%s且不增加跳過項目', async (_label, status, fields, paid) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client, { students: [status] })
    const jobId = await addPayrollJob(client, classId, [studentId], fields)
    const receipt = await commitOperation(client, runPayroll(classId, [jobId]))
    expect(receipt.result).toMatchObject({ noop: !paid, skipped: [] })
    expect(receipt.result.transactions).toHaveLength(Number(paid))
  })

  it('一般發薪跳過值日職務，其他職務仍照發', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const duty = await addPayrollJob(client, classId, [studentId], { salary: 3 })
    const normal = await addPayrollJob(client, classId, [studentId])
    await commitOperation(client, setSetting(classId, 'dutyJobId', duty))
    const receipt = await commitOperation(client, runPayroll(classId, [duty, normal]))
    expect(receipt.result).toMatchObject({
      paid: [{ job_id: normal, amount: 10 }],
      skipped: [{ job_id: duty, period: null, student_id: null, reason: 'duty_job' }],
    })
    expect(await payrollRows(client, classId)).toHaveLength(1)
  })

  it('省略日期時以操作提交時間的臺灣日期定期別', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const id = await addPayrollJob(client, classId, [studentId], { cycle: 'daily' })
    const receipt = await commitOperation(client, runPayroll(classId, [id], {}))
    const { rows: [{ day }] } = await client.query(
      "SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS day", [receipt.committed_at],
    )
    expect(receipt.result.paid).toMatchObject([{ period: day }])
  })

  it.each([
    ['缺少職務名單', { job_ids: undefined }], ['職務名單非陣列', { job_ids: 'job' }],
    ['空職務名單', { job_ids: [] }], ['重複職務', { job_ids: ['job', 'job'] }], ['空職務編號', { job_ids: [''] }],
    ['日期格式', { pay_date: '2026/02/01' }], ['日期不存在', { pay_date: '2026-02-30' }],
    ['多餘的鍵', { extra: true }], ['版本條件', {}, { rev: 0 }], ['空版本條件', {}, null],
  ])('OP-28 拒絕%s', async (_label, fields, ...versions) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = runPayroll(classId, [randomUUID()], { pay_date: payrollDay, ...fields })
    if (versions.length) op.expect = versions[0]
    await expectPayrollRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('有不存在的職務便整筆拒絕，且先拒絕小野與封存班', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const jobId = await addPayrollJob(client, classId, [studentId])
    const rejected = await expectPayrollRejection(client, runPayroll(classId, [jobId, randomUUID()]), 'NOT_FOUND')
    expect(rejected).not.toHaveProperty('current')
    await expectPayrollRole(client, (target) => runPayroll(target, [jobId]))
  })

  it('重送回原收據，改薪資保留原交易與效果，下一期用新薪資', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const jobId = await addPayrollJob(client, classId, [studentId])
    const op = runPayroll(classId, [jobId])
    const receipt = await commitOperation(client, op)
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    const original = await payrollRows(client, classId)
    const originalEffects = await client.query('SELECT * FROM ppt.effects WHERE class_id = $1', [classId])
    await commitOperation(client, saveJob(classId, { job_id: jobId, salary: 12 }, { rev: 2 }))
    expect(await payrollRows(client, classId)).toEqual(original)
    expect((await client.query('SELECT * FROM ppt.effects WHERE class_id = $1', [classId])).rows).toEqual(originalEffects.rows)
    const next = await commitOperation(client, runPayroll(classId, [jobId], { pay_date: '2027-01-04' }))
    expect(next.result.paid).toMatchObject([{ amount: 12 }])
  })

  it('單獨沖回結束效果並可補發，單獨更正仍佔同一期', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const jobId = await addPayrollJob(client, classId, studentIds)
    const receipt = await commitOperation(client, runPayroll(classId, [jobId]))
    const [reversed, corrected] = receipt.result.paid
    const reversal = await commitOperation(client, reverse(classId, reversed.transaction_id, 10))
    expect(reversal.result.effects_reversed).toMatchObject([{
      event: 'payroll', root_transaction_id: reversed.transaction_id, rule_id: null, rule_rev: null, effective_amount: 10,
    }])
    const { rows } = await client.query('SELECT status FROM ppt.effects WHERE class_id = $1 AND root_transaction_id = $2',
      [classId, reversed.transaction_id])
    expect(rows).toEqual([{ status: 'reversed' }])
    await commitOperation(client, correct(classId, corrected.transaction_id, 10, 7))
    const repeated = await commitOperation(client, runPayroll(classId, [jobId]))
    expect(repeated.result).toMatchObject({
      paid: [{ student_id: reversed.student_id }], skipped: [{ student_id: corrected.student_id, reason: 'already_paid' }],
    })
  })
})
