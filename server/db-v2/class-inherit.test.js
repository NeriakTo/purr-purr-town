import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/utils/constants.js'
import { authorizeAgent } from './test-support/agent.js'
import { saveAnnouncement, saveSeating, seatingRow } from './test-support/announcement-seating.js'
import { classSnapshot } from './test-support/checks.js'
import { commitClass, createClass } from './test-support/class-create.js'
import { saveGroup, setClassStatus } from './test-support/class-student-group.js'
import { saveComment } from './test-support/comments.js'
import { propose } from './test-support/confirmations.js'
import { adjustment, operationCount, submit, teacher } from './test-support/operations.js'
import { assignJob, retireJob, runPayroll, saveJob, setDuty } from './test-support/payroll.js'
import { retireProduct, saveProduct } from './test-support/products.js'
import { authorizeScheduler } from './test-support/scheduler.js'
import { commitOperation, createTask, retireRule, saveRule } from './test-support/schoolwork.js'
import { currency, setSetting } from './test-support/settings.js'
import { purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const otherTeacher = { kind: 'teacher', id: 'other-teacher-fixture' }
const settings = {
  currency: currency(13, 500),
  ruleCategories: [{ id: 'cat_test', name: '測試分類' }],
  taskTypes: ['測試作業類型'],
  shopMeta: { name: '測試商店', icon: '☆' },
}
const eventAmounts = { 'submission.late': -17, 'submission.missing': -23, 'daily_quest.complete': 87 }

function inherit(source, count = 1) {
  return createClass(count, randomUUID(), { inherit_from_class_id: source })
}

async function storedOperations(client, classId) {
  const { rows } = await client.query(
    'SELECT op_id, to_jsonb(o) AS value FROM ppt.operations o WHERE class_id = $1 ORDER BY op_id', [classId],
  )
  return rows
}

async function readRows(client, table, classId) {
  const { rows } = await client.query(`SELECT * FROM ppt.${table} WHERE class_id = $1`, [classId])
  return rows
}

async function setSourceRules(client, source) {
  const { classId, receipt } = source
  for (const change of receipt.changes.filter(c => c.entity === 'rule')) {
    const ruleId = change.key.rule_id
    const event = change.value.event
    if (event) {
      await commitOperation(client, saveRule(classId, {
        rule_id: ruleId, kind: 'event', event, name: '來源事件規則', amount: eventAmounts[event],
      }, 1))
    } else {
      await commitOperation(client, retireRule(classId, ruleId, 1))
    }
  }
  const manual = saveRule(classId, { name: '來源手動規則', amount: 7 })
  await commitOperation(client, manual)
  const ruleId = manual.payload.rule_id
  await commitOperation(client, saveRule(classId, {
    rule_id: ruleId, name: '更新手動規則', amount: 19, icon: '☆', category: '測試分類',
  }, 1))
  return ruleId
}

async function setSourceJobs(client, source) {
  const { classId, studentIds, receipt } = source
  for (const change of receipt.changes.filter(c => c.entity === 'job')) {
    await commitOperation(client, retireJob(classId, change.key.job_id))
  }
  const monthly = saveJob(classId, { title: '測試月薪職務' })
  const once = saveJob(classId, { title: '測試一次性職務', cycle: 'once' })
  const duty = saveJob(classId, { title: '測試值日職務', cycle: 'daily' })
  await commitOperation(client, monthly)
  await commitOperation(client, once)
  await commitOperation(client, duty)
  const monthlyId = monthly.payload.job_id
  const onceId = once.payload.job_id
  const dutyId = duty.payload.job_id
  await commitOperation(client, assignJob(classId, monthlyId, studentIds))
  await commitOperation(client, setSetting(classId, 'dutyJobId', dutyId))
  return { monthlyId, onceId, dutyId }
}

async function setSourceProducts(client, source) {
  const { classId, receipt } = source
  for (const change of receipt.changes.filter(c => c.entity === 'product')) {
    await commitOperation(client, retireProduct(classId, change.key.product_id, 1))
  }
  const product = saveProduct(classId, {
    name: '測試承接商品', price: 1, price_unit: 'fish', stock: 3, initial_stock: 3,
  })
  await commitOperation(client, product)
  const productId = product.payload.product_id
  await commitOperation(client, adjustment(source, 100))
  await commitOperation(client, purchase({ ...source, productId }, settings.currency.tier1.rate))
  expect(await readRows(client, 'products', classId)).toContainEqual(expect.objectContaining({
    product_id: productId, stock: 2, initial_stock: 3,
  }))
  return productId
}

async function prepareSource(client) {
  const source = await commitClass(client, createClass(2))
  const { classId, studentId } = source
  const ruleId = await setSourceRules(client, source)
  const jobs = await setSourceJobs(client, source)
  for (const [key, value] of Object.entries(settings)) {
    await commitOperation(client, setSetting(classId, key, value, { rev: 1 }))
  }
  const productId = await setSourceProducts(client, source)
  await commitOperation(client, saveGroup(classId, { leader_student_id: studentId }))
  await commitOperation(client, saveSeating(classId, {
    rows: 3, cols: 4, view: 'student', seats: { '0_0': studentId },
    objects: { '2_3': 'door', '3_2': 'window', '0_4': 'trash' },
    custom_objects: [{ id: 'test', name: '測試物件' }],
  }, { rev: 1 }))
  await commitOperation(client, saveAnnouncement(classId))
  await commitOperation(client, setDuty(classId, '2026-11-21', [studentId]))
  const task = createTask(classId)
  await commitOperation(client, task)
  await commitOperation(client, propose({ classId, studentId, taskId: task.payload.task_id }, 'missing'))
  await commitOperation(client, saveComment(source))
  await commitOperation(client, setSetting(classId, 'currentSemester', '115-1'))
  await commitOperation(client, setSetting(classId, 'semesterPeriods', DEFAULT_SETTINGS.semesterPeriods))
  await authorizeAgent(client, classId)
  await authorizeScheduler(client, classId)
  return { ...source, ruleId, productId, ...jobs }
}

async function assertInheritedResources(client, target, source) {
  const { classId } = target
  const jobs = await readRows(client, 'jobs', classId)
  expect(jobs).toHaveLength(3)
  for (const [id, cycle] of [[source.monthlyId, 'monthly'], [source.onceId, 'once'], [source.dutyId, 'daily']]) {
    expect(jobs).toContainEqual(expect.objectContaining({
      job_id: id, cycle, origin: 'op', disabled: false, rev: 1, assignee_ids: [],
    }))
  }
  expect(await readRows(client, 'products', classId)).toEqual([expect.objectContaining({
    product_id: source.productId, stock: 3, initial_stock: 3, disabled: false, rev: 1,
  })])
  const { rows: rules } = await client.query(`
    SELECT r.rule_id, r.kind, r.event, r.disabled, v.rev, v.name, v.amount::int, v.icon, v.category
    FROM ppt.rules r JOIN ppt.rule_versions v USING (class_id, rule_id, rev) WHERE class_id = $1
  `, [classId])
  expect(rules.filter(row => row.kind === 'manual')).toEqual([{
    rule_id: source.ruleId, kind: 'manual', event: null, disabled: false, rev: 1,
    name: '更新手動規則', amount: 19, icon: '☆', category: '測試分類',
  }])
  expect(Object.fromEntries(rules.filter(row => row.kind === 'event')
    .map(row => [row.event, row.amount]))).toEqual(eventAmounts)
  expect(rules.every(row => !row.disabled && row.rev === 1)).toBe(true)
  expect(Object.fromEntries((await readRows(client, 'settings_entries', classId))
    .map(row => [row.key, row.value]))).toEqual({ ...settings, dutyJobId: source.dutyId })
  expect(await readRows(client, 'groups', classId)).toEqual([expect.objectContaining({
    group_key: '組甲', name: '測試小組', leader_student_id: null, rev: 1,
  })])
  expect(await seatingRow(client, classId)).toMatchObject({
    rows: 3, cols: 4, view: 'student', seats: {}, objects: { '2_3': 'door' },
    custom_objects: [{ id: 'test', name: '測試物件' }], rev: 1,
  })
}

async function assertFreshClass(client, target) {
  const { classId, studentId, op } = target
  expect(await readRows(client, 'students', classId)).toEqual([expect.objectContaining({ student_id: studentId })])
  expect(await readRows(client, 'accounts', classId)).toEqual([expect.objectContaining({ student_id: studentId })])
  expect((await storedOperations(client, classId)).map(row => row.op_id)).toEqual([op.op_id])
  for (const table of [
    'daily_duties', 'announcements', 'transactions', 'tasks', 'submissions', 'comments',
    'confirmations', 'agent_calls', 'inventory_items', 'effects', 'corrections',
  ]) expect(await readRows(client, table, classId)).toEqual([])
  expect(await readRows(client, 'class_authorizations', classId)).toEqual([
    { class_id: classId, actor_kind: 'scheduler' },
  ])
}

async function waitForSourceBlock(observer, waiter, locker) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const { rows: [row] } = await observer.query(
      'SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked', [waiter.processID, locker.processID],
    )
    if (row.blocked) return
  }
  throw new Error('沒有觀察到承接交易等待來源班列鎖')
}

describeDatabase('OP-01 建班承接', () => {
  const database = useTestDatabase()

  it.each(['別人的班', '不存在的班', '新班本身'])('03:376 承接%s回 CLASS_FORBIDDEN 且不留資料', async (kind) => {
    const { client } = database()
    const foreign = await commitClass(client, createClass(1), otherTeacher)
    const next = randomUUID()
    const source = { 別人的班: foreign.classId, 不存在的班: randomUUID(), 新班本身: next }[kind]
    const op = createClass(1, next, { inherit_from_class_id: source })
    const before = await classSnapshot(client, foreign.classId)
    const count = await operationCount(client)
    expect(await submit(client, op)).toEqual({ op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' })
    expect(await classSnapshot(client, next)).toBe(await classSnapshot(client, randomUUID()))
    expect(await operationCount(client)).toBe(count)
    expect(await classSnapshot(client, foreign.classId)).toBe(before)
  })

  it('逐類複製啟用資源並重設庫存與指派，來源保持原值', async () => {
    const { client } = database()
    const source = await prepareSource(client)
    const before = await classSnapshot(client, source.classId)
    const ops = await storedOperations(client, source.classId)
    const target = await commitClass(client, inherit(source.classId))
    expect(target.receipt.result.class.inherited_from).toBe(source.classId)
    await assertInheritedResources(client, target, source)
    await assertFreshClass(client, target)
    expect(await classSnapshot(client, source.classId)).toBe(before)
    expect(await storedOperations(client, source.classId)).toEqual(ops)

    for (const jobId of [source.monthlyId, source.onceId]) {
      await commitOperation(client, assignJob(target.classId, jobId, [target.studentId]))
      const payroll = await commitOperation(client, runPayroll(target.classId, [jobId]))
      expect(payroll.result.transactions).toHaveLength(1)
    }
    await commitOperation(client, purchase({ ...target, productId: source.productId }, settings.currency.tier1.rate))
  })

  it('來源未設值日職務時不另建值日職務設定', async () => {
    const { client } = database()
    const source = await commitClass(client, createClass(0))
    const { classId } = await commitClass(client, inherit(source.classId, 0))
    expect((await readRows(client, 'settings_entries', classId)).map(row => row.key)).not.toContain('dutyJobId')
  })

  it('空的舊班可在封存後承接，僅補預設設定、事件規則與座位', async () => {
    const { client } = database()
    const source = randomUUID()
    await client.query('INSERT INTO ppt.classes (class_id) VALUES ($1)', [source])
    await client.query('INSERT INTO ppt.class_ownership VALUES ($1, $2)', [source, teacher.id])
    await commitOperation(client, setClassStatus(source, 'archived'))
    const { classId, receipt } = await commitClass(client, inherit(source, 0))
    expect(receipt.changes.map(change => change.entity)).toEqual([
      'class', ...Array(4).fill('setting'), ...Array(3).fill('rule'), 'seating',
    ])
    expect(await readRows(client, 'jobs', classId)).toEqual([])
    expect(await readRows(client, 'products', classId)).toEqual([])
    expect(await seatingRow(client, classId)).toMatchObject({ rows: 6, cols: 8, seats: {}, objects: {} })
    expect(Object.fromEntries(receipt.changes.filter(change => change.entity === 'rule')
      .map(change => [change.value.event, change.value.amount]))).toEqual({
      'submission.late': DEFAULT_SETTINGS.automation.latePenalty,
      'submission.missing': DEFAULT_SETTINGS.automation.missingPenalty,
      'daily_quest.complete': DEFAULT_SETTINGS.automation.dailyQuestBonus,
    })
  })

  it('來源列鎖等待期間撤掉擁有者，重驗拒絕且不登記', async () => {
    const { client, connect } = database()
    const source = await commitClass(client, createClass(0))
    const [locker, waiter] = await Promise.all([connect(), connect()])
    const op = inherit(source.classId)
    const count = await operationCount(client)
    await locker.query('BEGIN')
    let pending
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [source.classId])
      await locker.query('DELETE FROM ppt.class_ownership WHERE class_id = $1', [source.classId])
      pending = Promise.allSettled([submit(waiter, op)])
      await waitForSourceBlock(client, waiter, locker)
      await locker.query('COMMIT')
    } catch (error) {
      await locker.query('ROLLBACK')
      await pending
      throw error
    }
    const [result] = await pending
    expect(result).toEqual({
      status: 'fulfilled', value: { op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' },
    })
    expect(await operationCount(client)).toBe(count)
    expect(await readRows(client, 'classes', op.class_id)).toEqual([])
  })
})
