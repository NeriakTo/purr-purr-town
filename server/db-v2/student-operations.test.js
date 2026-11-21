import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  addStudentOperation, setStudentEnrollment, setStudentExemptRules, studentRow, updateStudentProfile,
} from './test-support/class-student-group.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { saveProduct } from './test-support/products.js'
import { commitOperation, createTask, operation, saveRule } from './test-support/schoolwork.js'
import { purchase } from './test-support/shop.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const homeworkRule = { keyword: '測試', taskType: '作業' }
const readingRule = { keyword: '閱讀', taskType: '閱讀' }

async function expectStudentRejection(client, op, code, withCurrent = false) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  if (!withCurrent) expect(receipt).not.toHaveProperty('current')
  expect(await classSnapshot(client, op.class_id)).toEqual(before)
  return receipt
}

async function studentLedgerAndSubmissions(client, classId) {
  const accounts = await client.query('SELECT * FROM ppt.accounts WHERE class_id = $1', [classId])
  const transactions = await client.query('SELECT * FROM ppt.transactions WHERE class_id = $1', [classId])
  const submissions = await client.query('SELECT * FROM ppt.submissions WHERE class_id = $1', [classId])
  return { accounts: accounts.rows, transactions: transactions.rows, submissions: submissions.rows }
}

describeDatabase('學生資料與在學狀態', () => {
  const database = useTestDatabase()

  it.each([undefined, '組甲', null])('OP-04 建學生及零餘額帳戶，分組為 %s', async (groupKey) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = addStudentOperation(classId, { group_key: groupKey })
    const target = { classId, studentId: op.payload.student_id }
    const receipt = await commitOperation(client, op)
    const value = {
      name: '2號村民', seat_number: 2, avatar: null, group_key: groupKey ?? null,
      enrollment_status: 'enrolled', exempt_rules: [],
    }
    expect(await studentRow(client, target)).toMatchObject({ ...value, rev: 1, last_op_id: op.op_id })
    const { rows: [account] } = await client.query(
      'SELECT * FROM ppt.accounts WHERE class_id = $1 AND student_id = $2', [classId, target.studentId],
    )
    expect(account).toMatchObject({ balance: '0', total_earned: '0', rev: 1 })
    expect(receipt.changes).toEqual([
      { entity: 'student', key: { student_id: target.studentId }, prev_rev: 0, rev: 1,
        last_op_id: op.op_id, prev_value: null, value },
      { entity: 'account', key: { student_id: target.studentId }, prev_rev: 0, rev: 1,
        last_op_id: op.op_id, prev_value: null, value: { balance: 0, total_earned: 0 } },
    ])
    await commitOperation(client, adjustment(target, 1))
  })

  it.each([
    ['enrolled', 'INVALID_PAYLOAD'], ['home_study', 'INVALID_PAYLOAD'],
    ['transferred', 'OK'], ['archived', 'OK'],
  ])('OP-04 原座號持有人為 %s 時回 %s', async (status, code) => {
    const { client } = database()
    const { classId } = await addClass(client, { students: [status] })
    const op = addStudentOperation(classId, { seat_number: 1, name: '1號村民' })
    if (code === 'OK') await commitOperation(client, op)
    else await expectStudentRejection(client, op, code)
  })

  it('OP-04 本班編號與座號同時重複優先回 ID_CONFLICT', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await expectStudentRejection(client, addStudentOperation(classId, {
      student_id: studentId, seat_number: 1, name: '1號村民',
    }), 'ID_CONFLICT')
  })

  it('OP-04 可建別班已使用的學生編號，別班快照保持原值', async () => {
    const { client } = database()
    const source = await addClass(client)
    const { classId } = await addClass(client)
    const before = await classSnapshot(client, source.classId)
    await commitOperation(client, addStudentOperation(classId, { student_id: source.studentId }))
    expect(await classSnapshot(client, source.classId)).toEqual(before)
  })

  it('OP-04 新增學生後可用 OP-14 的 rev 0 補指派既有作業', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const task = createTask(classId)
    await commitOperation(client, task)
    const student = addStudentOperation(classId)
    await commitOperation(client, student)
    const target = { classId, taskId: task.payload.task_id, studentId: student.payload.student_id }
    await commitOperation(client, setStatus(target, 'on_time', { rev: 0 }))
    expect(await submissionRow(client, target)).toMatchObject({ status: 'on_time', rev: 1 })
  })

  it.each([
    ['缺姓名', { name: undefined }], ['多鍵', { extra: 1 }],
    ['座號為零', { seat_number: 0 }], ['座號有小數', { seat_number: 1.5 }],
    ['座號過大', { seat_number: 1000 }], ['空姓名', { name: '' }], ['空組別', { group_key: '' }],
    ['非 v4 編號', { student_id: 'a'.repeat(64) }], ['帶版本', {}, { rev: 1 }], ['帶空版本', {}, null],
  ])('OP-04 拒絕%s', async (_name, fields, version) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = addStudentOperation(classId, fields)
    if (version !== undefined) op.expect = version
    await expectStudentRejection(client, op, 'INVALID_PAYLOAD')
  })

  it.each([
    ['name', '2號村民'], ['seat_number', 2], ['avatar', '測試頭像'],
  ])('OP-05 局部更新 %s，只列該欄的前後值', async (key, value) => {
    const { client } = database()
    const target = await addClass(client)
    const before = await studentRow(client, target)
    const op = updateStudentProfile(target, { [key]: value })
    const receipt = await commitOperation(client, op)
    expect(await studentRow(client, target)).toEqual({ ...before, [key]: value, rev: 2, last_op_id: op.op_id })
    expect(receipt.changes).toMatchObject([{ entity: 'student', prev_rev: 1, rev: 2 }])
    expect(receipt.changes[0].prev_value).toEqual({ [key]: before[key] })
    expect(receipt.changes[0].value).toEqual({ [key]: value })
  })

  it('OP-05 空頭像清除原值', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, updateStudentProfile(target, { avatar: '測試頭像' }))
    const receipt = await commitOperation(client, updateStudentProfile(target, { avatar: null }, { rev: 2 }))
    expect(receipt.changes[0].value).toEqual({ avatar: null })
    expect(await studentRow(client, target)).toMatchObject({ avatar: null, rev: 3 })
  })

  it('OP-05 座號衝突晚於版本檢查，轉出學生仍可改成已用座號', async () => {
    const { client } = database()
    const target = await addClass(client, { students: ['enrolled', 'home_study'] })
    await expectStudentRejection(client, updateStudentProfile(target, { seat_number: 2 }), 'INVALID_PAYLOAD')
    await expectStudentRejection(client, updateStudentProfile(target, { seat_number: 2 }, { rev: 9 }), 'STALE_STATE', true)
    const transfer = setStudentEnrollment(target, 'transferred')
    await commitOperation(client, transfer)
    await commitOperation(client, updateStudentProfile(target, { seat_number: 2 }, { after_op: transfer.op_id }))
    expect(await studentRow(client, target)).toMatchObject({ seat_number: 2, enrollment_status: 'transferred', rev: 3 })
  })

  it('OP-05 同值保持版本，過期回六欄現值，缺少學生回 NOT_FOUND', async () => {
    const { client } = database()
    const target = await addClass(client)
    const before = await studentRow(client, target)
    const same = await commitOperation(client, updateStudentProfile(target, { name: '1號村民' }))
    expect(same).toMatchObject({ result: { noop: true }, changes: [{ prev_rev: 1, rev: 1 }] })
    expect(await studentRow(client, target)).toEqual(before)
    const stale = await expectStudentRejection(
      client, updateStudentProfile(target, { name: '2號村民' }, { rev: 2 }), 'STALE_STATE', true,
    )
    expect(stale.current.value).toEqual({
      name: '1號村民', seat_number: 1, avatar: null, group_key: null, enrollment_status: 'enrolled', exempt_rules: [],
    })
    await expectStudentRejection(
      client, updateStudentProfile({ ...target, studentId: randomUUID() }, { name: '2號村民' }), 'NOT_FOUND',
    )
  })

  it.each([
    ['無資料', {}], ['多鍵', { name: '1號村民', extra: 1 }], ['省略版本', { name: '1號村民' }],
    ['頭像型別錯誤', { avatar: 9 }], ['頭像過長', { avatar: '像'.repeat(201) }],
  ])('OP-05 拒絕%s', async (name, fields) => {
    const { client } = database()
    const target = await addClass(client)
    const op = updateStudentProfile(target, fields)
    if (name === '省略版本') delete op.expect
    await expectStudentRejection(client, op, 'INVALID_PAYLOAD')
  })

  it.each([
    ['enrolled', 'home_study'], ['home_study', 'transferred'], ['transferred', 'archived'],
    ['archived', 'enrolled'], ['enrolled', 'transferred'], ['transferred', 'home_study'],
  ])('OP-06 從 %s 改為 %s 保留帳戶、交易與繳交', async (from, to) => {
    const { client } = database()
    const target = await addClass(client)
    const task = createTask(target.classId)
    await commitOperation(client, task)
    await commitOperation(client, adjustment(target, 3))
    const initial = await commitOperation(client, setStudentEnrollment(target, from))
    const before = await studentLedgerAndSubmissions(client, target.classId)
    const receipt = await commitOperation(client, setStudentEnrollment(target, to, { rev: initial.changes[0].rev }))
    const after = await studentLedgerAndSubmissions(client, target.classId)
    expect(receipt.changes[0]).toMatchObject({
      prev_value: { enrollment_status: from }, value: { enrollment_status: to }, rev: initial.changes[0].rev + 1,
    })
    expect(await studentRow(client, target)).toMatchObject({ enrollment_status: to, rev: receipt.changes[0].rev })
    for (const table of ['accounts', 'transactions', 'submissions']) {
      expect(after[table]).toEqual(before[table])
      expect(after[table]).toHaveLength(1)
    }
  })

  it.each([
    ['OP-24', (_client, target) => adjustment(target, 1)],
    ['OP-25', async (client, target) => {
      const rule = saveRule(target.classId)
      await commitOperation(client, rule)
      return operation(target.classId, 'points.apply_rule', {
        student_id: target.studentId, rule_id: rule.payload.rule_id, rule_version: 1,
      })
    }],
    ['OP-31', async (client, target) => {
      const product = saveProduct(target.classId)
      await commitOperation(client, product)
      return purchase({ ...target, productId: product.payload.product_id })
    }],
    ['OP-10', (_client, target) => createTask(target.classId, { assignee_ids: [target.studentId] })],
  ])('OP-06 轉出時擋下 %s，復學後可用新編號成立', async (_name, makeOp) => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, adjustment(target, 10))
    const op = await makeOp(client, target)
    await commitOperation(client, setStudentEnrollment(target, 'transferred'))
    await expectStudentRejection(client, op, 'ENTITY_INACTIVE')
    await commitOperation(client, setStudentEnrollment(target, 'enrolled', { rev: 2 }))
    await commitOperation(client, { ...op, op_id: randomUUID() })
  })

  it('OP-06 封存學生後 OP-24 回 ENTITY_INACTIVE', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, setStudentEnrollment(target, 'archived'))
    await expectStudentRejection(client, adjustment(target, 1), 'ENTITY_INACTIVE')
  })

  it('OP-06 復學座號衝突先於版本，改座號後可復學', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, setStudentEnrollment(target, 'transferred'))
    await commitOperation(client, addStudentOperation(target.classId, { seat_number: 1, name: '1號村民' }))
    for (const rev of [2, 1]) {
      await expectStudentRejection(client, setStudentEnrollment(target, 'enrolled', { rev }), 'INVALID_TRANSITION')
    }
    const profile = updateStudentProfile(target, { seat_number: 3 }, { rev: 2 })
    await commitOperation(client, profile)
    await commitOperation(client, setStudentEnrollment(target, 'enrolled', { after_op: profile.op_id }))
    expect(await studentRow(client, target)).toMatchObject({ seat_number: 3, enrollment_status: 'enrolled', rev: 4 })
  })

  it('OP-06 同值保持版本並區分無效狀態與過期版本', async () => {
    const { client } = database()
    const target = await addClass(client)
    const before = await studentRow(client, target)
    const receipt = await commitOperation(client, setStudentEnrollment(target, 'enrolled'))
    expect(receipt).toMatchObject({ result: { noop: true }, changes: [{ prev_rev: 1, rev: 1 }] })
    expect(await studentRow(client, target)).toEqual(before)
    await expectStudentRejection(client, setStudentEnrollment(target, 'closed'), 'INVALID_PAYLOAD')
    await expectStudentRejection(client, setStudentEnrollment(target, 'home_study', { rev: 2 }), 'STALE_STATE', true)
  })

  it('OP-07 保留規則順序，整份取代並可清空', async () => {
    const { client } = database()
    const target = await addClass(client)
    const versions = [[readingRule, homeworkRule], [homeworkRule], []]
    for (const [index, rules] of versions.entries()) {
      const receipt = await commitOperation(client, setStudentExemptRules(target, rules, { rev: index + 1 }))
      expect(receipt.changes[0].value).toEqual({ exempt_rules: rules })
      expect(await studentRow(client, target)).toMatchObject({ exempt_rules: rules, rev: index + 2 })
    }
    expect(await commitOperation(client, setStudentExemptRules(target, [], { rev: 4 }))).toMatchObject({
      result: { noop: true }, changes: [{ prev_rev: 4, rev: 4 }],
    })
  })

  it('OP-07 的免交規則只套用於之後建立的作業', async () => {
    const { client } = database()
    const target = await addClass(client)
    const first = createTask(target.classId)
    const second = createTask(target.classId)
    await commitOperation(client, first)
    await commitOperation(client, setStudentExemptRules(target, [homeworkRule]))
    await commitOperation(client, second)
    expect(await submissionRow(client, { ...target, taskId: first.payload.task_id })).toMatchObject({ status: 'pending' })
    expect(await submissionRow(client, { ...target, taskId: second.payload.task_id })).toMatchObject({ status: 'exempt' })
  })

  it.each([
    ['非陣列', {}], ['項目多鍵', [{ ...homeworkRule, extra: 1 }]],
    ['空關鍵字', [{ ...homeworkRule, keyword: '' }]], ['超過上限', Array(51).fill(homeworkRule)],
  ])('OP-07 拒絕%s', async (_name, rules) => {
    const { client } = database()
    const target = await addClass(client)
    await expectStudentRejection(client, setStudentExemptRules(target, rules), 'INVALID_PAYLOAD')
  })

  it('OP-05 至 OP-07 用 after_op 串接同一學生，三種都拒絕最舊版本', async () => {
    const { client } = database()
    const target = await addClass(client)
    const profile = updateStudentProfile(target, { name: '2號村民' })
    const enrollment = setStudentEnrollment(target, 'home_study', { after_op: profile.op_id })
    const rules = setStudentExemptRules(target, [homeworkRule], { after_op: enrollment.op_id })
    for (const [index, op] of [profile, enrollment, rules].entries()) {
      const receipt = await commitOperation(client, op)
      expect(receipt.changes[0].rev).toBe(index + 2)
    }
    for (const op of [profile, enrollment, rules]) {
      await expectStudentRejection(client, { ...op, op_id: randomUUID(), expect: { rev: 1 } }, 'STALE_STATE', true)
    }
  })
})
