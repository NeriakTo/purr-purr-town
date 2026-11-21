import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { addClass } from './test-support/operations.js'
import {
  addPayrollJob, expectPayrollRejection, expectPayrollRole, payDuty, payrollDay, payrollRows, prepareDuty,
  saveJob, setCutover, setDuty,
} from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { transactionFrom } from './test-support/transactions.js'

const nextDay = '2026-12-08'
const cutover = '2026-11-15'
const legacyDay = '2026-11-14'

async function storedDuty(client, classId) {
  const { rows } = await client.query(`
    SELECT to_char(duty_date, 'YYYY-MM-DD') AS date, student_ids, rev, last_op_id
    FROM ppt.daily_duties WHERE class_id = $1 ORDER BY duty_date
  `, [classId])
  return rows
}

async function dutyEffects(client, classId) {
  const { rows } = await client.query('SELECT * FROM ppt.effects WHERE class_id = $1 ORDER BY effect_id', [classId])
  return rows
}

function skipDuty(student_id, date = payrollDay, reason = 'already_paid') {
  return { student_id, date, reason }
}

describeDatabase('值日名單 OP-29', () => {
  const database = useTestDatabase()

  it('各日期獨立版本，保留名單順序並可同值或清空', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second] } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const created = await commitOperation(client, setDuty(classId, payrollDay, [second, first]))
    expect(created.changes).toEqual([{
      entity: 'duty', key: { date: payrollDay }, prev_rev: 0, rev: 1, last_op_id: created.op_id,
      prev_value: null, value: { student_ids: [second, first] },
    }])
    const replaced = await commitOperation(client, setDuty(classId, payrollDay, [first], { rev: 1 }))
    expect(replaced.changes).toMatchObject([{
      prev_rev: 1, rev: 2, prev_value: { student_ids: [second, first] }, value: { student_ids: [first] },
    }])
    const same = await commitOperation(client, setDuty(classId, payrollDay, [first], { after_op: replaced.op_id }))
    expect(same.result.noop).toBe(true)
    expect(same.changes).toMatchObject([{ prev_rev: 2, rev: 2, last_op_id: replaced.op_id }])
    for (const rev of [0, 1]) {
      const rejected = await expectPayrollRejection(client, setDuty(classId, payrollDay, [], { rev }), 'STALE_STATE')
      expect(rejected.current).toMatchObject({ rev: 2, value: { student_ids: [first] } })
    }
    const other = await commitOperation(client, setDuty(classId, nextDay, [second]))
    expect(other.changes).toMatchObject([{ rev: 1 }])
    const cleared = await commitOperation(client, setDuty(classId, payrollDay, [], { rev: 2 }))
    expect(await storedDuty(client, classId)).toEqual([
      { date: payrollDay, student_ids: [], rev: 3, last_op_id: cleared.op_id },
      { date: nextDay, student_ids: [second], rev: 1, last_op_id: other.op_id },
    ])
  })

  it.each([
    ['無效日期', { date: '2026-02-30' }], ['非陣列', { student_ids: 'student' }],
    ['重複學生', { student_ids: ['a', 'a'] }], ['空學生編號', { student_ids: [''] }],
    ['多餘欄位', { extra: true }], ['沒有版本', {}, undefined], ['空版本', {}, null],
    ['雙版本條件', {}, { rev: 0, after_op: 'op' }],
  ])('拒絕%s的值日名單', async (_label, fields, ...versions) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const op = setDuty(classId, payrollDay, [studentId])
    Object.assign(op.payload, fields)
    if (versions.length) op.expect = versions[0]
    await expectPayrollRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('名單可保存轉出學生，查不到學生先於版本不符', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client, { students: ['transferred'] })
    const receipt = await commitOperation(client, setDuty(classId, payrollDay, [studentId]))
    expect(receipt.changes).toMatchObject([{ value: { student_ids: [studentId] } }])
    const rejection = await expectPayrollRejection(client, setDuty(classId, payrollDay, [randomUUID()]), 'NOT_FOUND')
    expect(rejection).not.toHaveProperty('current')
  })

  it('小野與封存班不能設定值日名單', async () => {
    await expectPayrollRole(database().client, (classId) => setDuty(classId, payrollDay, []))
  })
})

describeDatabase('值日薪資 OP-30', () => {
  const database = useTestDatabase()

  it('按學生編號發放指定日的值日薪，重送新操作逐人列已發', async () => {
    const { client } = database()
    const { classId, studentIds } = await prepareDuty(client)
    const receipt = await commitOperation(client, payDuty(classId, payrollDay))
    const sorted = [...studentIds].sort()
    expect(receipt.result).toMatchObject({ noop: false, skipped: [], effects_reversed: [] })
    expect(receipt.warnings).toEqual([])
    expect(receipt.changes.map(({ entity, key }) => [entity, key.student_id]))
      .toEqual(sorted.map((id) => ['account', id]))
    const effects = await dutyEffects(client, classId)
    expect(effects).toHaveLength(2)
    for (const [index, student_id] of sorted.entries()) {
      const transaction_id = receipt.result.transactions[index]
      expect(receipt.result.paid[index]).toEqual({ student_id, date: payrollDay, transaction_id, amount: 3 })
      expect(await transactionFrom(client, receipt, index)).toMatchObject({
        student_id, kind: 'payroll', amount: '3', earned_delta: '3', rule_id: null, rule_rev: null,
        occurred_at: new Date(receipt.committed_at), effective_at: new Date(receipt.committed_at),
        reason: '值日生 薪資 (' + payrollDay + ')',
      })
      const effect = receipt.result.effects_added[index]
      expect(effect).toEqual({
        effect_id: effect.effect_id, lineage_id: effect.effect_id, event: 'duty_pay',
        subject_kind: 'date', subject_key: payrollDay, root_transaction_id: transaction_id, amount: 3,
      })
      expect(effects.find((row) => row.effect_id === effect.effect_id)).toMatchObject({
        student_id, status: 'active', origin: 'op', lineage_id: effect.effect_id,
        event: 'duty_pay', subject_kind: 'date', subject_key: payrollDay, root_transaction_id: transaction_id,
        rule_id: null, rule_rev: null, created_op_id: receipt.op_id,
      })
    }
    const repeated = await commitOperation(client, payDuty(classId, payrollDay))
    expect(repeated).toMatchObject({ changes: [], result: {
      noop: true, transactions: [], paid: [], skipped: sorted.map((id) => skipDuty(id)),
    } })
  })

  it('取代名單保留已發交易與效果，補發新加入的學生', async () => {
    const { client } = database()
    const { classId, studentIds: [, second, third] } = await prepareDuty(client, { students: Array(3).fill('enrolled') })
    await commitOperation(client, payDuty(classId, payrollDay))
    const original = await payrollRows(client, classId)
    const originalEffects = await dutyEffects(client, classId)
    await commitOperation(client, setDuty(classId, payrollDay, [second, third], { rev: 1 }))
    expect(await payrollRows(client, classId)).toEqual(original)
    expect(await dutyEffects(client, classId)).toEqual(originalEffects)
    const receipt = await commitOperation(client, payDuty(classId, payrollDay))
    expect(receipt.result).toMatchObject({ paid: [{ student_id: third, amount: 3 }], skipped: [skipDuty(second)] })
  })

  it('同一天更換值日職務後仍逐人防重，另一天用新職務金額', async () => {
    const { client } = database()
    const { classId, studentIds } = await prepareDuty(client)
    await commitOperation(client, payDuty(classId, payrollDay))
    const nextJob = await addPayrollJob(client, classId, [], { salary: 6 })
    await commitOperation(client, setSetting(classId, 'dutyJobId', nextJob, { rev: 1 }))
    const repeated = await commitOperation(client, payDuty(classId, payrollDay))
    expect(repeated.result).toMatchObject({
      noop: true, paid: [], skipped: [...studentIds].sort().map((id) => skipDuty(id)),
    })
    await commitOperation(client, setDuty(classId, nextDay, [studentIds[0]]))
    const other = await commitOperation(client, payDuty(classId, nextDay))
    expect(other.result.paid).toMatchObject([{ amount: 6, date: nextDay }])
  })

  it.each(['未設定職務', '職務為空值', '沒有名單', '空名單'])('%s時拒絕發值日薪資', async (state) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    if (state === '職務為空值') await commitOperation(client, setSetting(classId, 'dutyJobId', null))
    if (state === '沒有名單' || state === '空名單') {
      const jobId = await addPayrollJob(client, classId, [])
      await commitOperation(client, setSetting(classId, 'dutyJobId', jobId))
    }
    if (state !== '沒有名單') {
      await commitOperation(client, setDuty(classId, payrollDay, state === '空名單' ? [] : [studentId]))
    }
    await expectPayrollRejection(client, payDuty(classId, payrollDay), 'INVALID_TRANSITION')
  })

  it('只發當天名單內符合在學範圍者，使用送出時的薪資', async () => {
    const { client } = database()
    const { classId, studentIds: [student], jobId } = await prepareDuty(client, {
      students: ['home_study', 'transferred', 'archived', 'enrolled'], roster: [0, 1, 2], assigned: [3],
    })
    await commitOperation(client, saveJob(classId, { job_id: jobId, salary: 4 }, { rev: 2 }))
    const receipt = await commitOperation(client, payDuty(classId, payrollDay))
    expect(receipt.result).toMatchObject({ paid: [{ student_id: student, amount: 4 }], skipped: [] })
    expect(await payrollRows(client, classId)).toHaveLength(1)
  })

  it('零薪資成立但不發也不列，即使日期在切換前', async () => {
    const { client } = database()
    const { classId } = await prepareDuty(client, { salary: 0, day: legacyDay })
    await setCutover(client, classId, cutover)
    const receipt = await commitOperation(client, payDuty(classId, legacyDay))
    expect(receipt).toMatchObject({ changes: [], result: { noop: true, paid: [], skipped: [], transactions: [] } })
  })

  it.each([
    ['缺少日期', { date: undefined }], ['無效日期', { date: '2026-02-30' }],
    ['非布林旗標', { include_legacy_periods: 'true' }], ['空旗標', { include_legacy_periods: null }],
    ['多餘欄位', { extra: true }], ['版本條件', {}, { rev: 0 }], ['空版本條件', {}, null],
  ])('值日發薪拒絕%s', async (_label, fields, ...versions) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = payDuty(classId, payrollDay, fields)
    if (versions.length) op.expect = versions[0]
    await expectPayrollRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('小野與封存班不能發值日薪資', async () => {
    await expectPayrollRole(database().client, (classId) => payDuty(classId, payrollDay))
  })

  it('切換日前逐人列待確認，帶旗標發放後列已發，切換日照發', async () => {
    const { client } = database()
    const { classId, studentIds } = await prepareDuty(client, { day: legacyDay })
    await setCutover(client, classId, cutover)
    const sorted = [...studentIds].sort()
    const withheld = await commitOperation(client, payDuty(classId, legacyDay))
    expect(withheld).toMatchObject({ changes: [], result: {
      noop: true, transactions: [], paid: [], skipped: sorted.map((id) => skipDuty(id, legacyDay, 'legacy_period')),
    } })
    const confirmed = await commitOperation(client, payDuty(classId, legacyDay, { include_legacy_periods: true }))
    expect(confirmed.result.paid).toHaveLength(2)
    const repeated = await commitOperation(client, payDuty(classId, legacyDay))
    expect(repeated).toMatchObject({ changes: [], result: {
      noop: true, transactions: [], paid: [], skipped: sorted.map((id) => skipDuty(id, legacyDay)),
    } })
    await commitOperation(client, setDuty(classId, cutover, studentIds))
    const sameDay = await commitOperation(client, payDuty(classId, cutover))
    expect(sameDay.result.paid).toHaveLength(2)
  })

  it('同一舊日逐人區分已發和待確認，轉出學生不列', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second, third] } = await prepareDuty(client, {
      students: ['enrolled', 'home_study', 'transferred'], roster: [0], day: legacyDay,
    })
    await setCutover(client, classId, cutover)
    await commitOperation(client, payDuty(classId, legacyDay, { include_legacy_periods: true }))
    await commitOperation(client, setDuty(classId, legacyDay, [third, second, first], { rev: 1 }))
    const receipt = await commitOperation(client, payDuty(classId, legacyDay, { include_legacy_periods: false }))
    const skipped = [skipDuty(first, legacyDay), skipDuty(second, legacyDay, 'legacy_period')]
      .sort((a, b) => a.student_id < b.student_id ? -1 : 1)
    expect(receipt.result).toMatchObject({ noop: true, paid: [], skipped })
  })
})
