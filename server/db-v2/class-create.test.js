import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/utils/constants.js'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { uuidV5 } from './test-support/batch-uuid.js'
import { classSnapshot } from './test-support/checks.js'
import { commitClass, createClass } from './test-support/class-create.js'
import { setClassStatus } from './test-support/class-student-group.js'
import { system } from './test-support/comments.js'
import { adjustment, cancel, operationCount, submit, teacher } from './test-support/operations.js'
import { commitOperation, createTask, operation } from './test-support/schoolwork.js'
import { purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const namespace = '7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8'
const fixedClass = '33333333-3333-4333-8333-333333333333'
const otherTeacher = { kind: 'teacher', id: 'other-teacher-fixture' }
const scheduler = { kind: 'scheduler', id: 'scheduler' }

async function expectAbsent(client, classId, operationRows) {
  expect(await classSnapshot(client, classId)).toBe(await classSnapshot(client, randomUUID()))
  const result = await client.query(
    'SELECT status, code, class_seq FROM ppt.operations WHERE class_id = $1', [classId],
  )
  expect(result.rows).toEqual(operationRows)
}

function defaultId(classId, category, id) {
  return uuidV5(namespace, `class.create:${classId}:${category}:${id}`)
}

function changeValues(receipt, entity, key) {
  return Object.fromEntries(receipt.changes.filter(change => change.entity === entity)
    .map(change => [change.key[key], change.value]))
}

function assertDefaultRules(receipt, classId) {
  const values = changeValues(receipt, 'rule', 'rule_id')
  const automation = DEFAULT_SETTINGS.automation
  const events = [
    ['submission.late', '作業遲交', automation.latePenalty],
    ['submission.missing', '作業缺交', automation.missingPenalty],
    ['daily_quest.complete', '每日任務獎勵', automation.dailyQuestBonus],
  ]
  const expected = events.map(([event, name, amount]) => [defaultId(classId, 'rule', event), {
    kind: 'event', event, name, amount, disabled: false, icon: null, category: null,
  }])
  for (const { id, label, amount, icon, category } of DEFAULT_SETTINGS.behaviorRules) {
    expected.push([defaultId(classId, 'rule', id), {
      kind: 'manual', event: null, name: label, amount, icon, category, disabled: false,
    }])
  }
  expect(values).toEqual(Object.fromEntries(expected))
  const ids = receipt.changes.filter(change => change.entity === 'rule').map(change => change.key.rule_id)
  expect(ids).toEqual([...expected.slice(0, 3).map(([id]) => id).sort(),
    ...expected.slice(3).map(([id]) => id).sort()])
}

function assertDefaultResources(receipt, classId) {
  const { currency, ruleCategories, taskTypes, shop, jobs, seatingChart } = DEFAULT_SETTINGS
  expect(changeValues(receipt, 'setting', 'key')).toEqual({
    currency: { value: currency }, ruleCategories: { value: ruleCategories }, taskTypes: { value: taskTypes },
    shopMeta: { value: { name: shop.name, icon: shop.icon } },
  })
  expect(changeValues(receipt, 'job', 'job_id')).toEqual(Object.fromEntries(
    jobs.map(({ id, ...fields }) => [defaultId(classId, 'job', id), {
      ...fields, disabled: false, assignee_ids: [],
    }]),
  ))
  expect(changeValues(receipt, 'product', 'product_id')).toEqual(Object.fromEntries(
    shop.products.map(({ id, name, icon, price, priceUnit, initialStock }) => [defaultId(classId, 'product', id), {
      name, icon, price, price_unit: priceUnit, stock: initialStock, initial_stock: initialStock,
      description: null, disabled: false,
    }]),
  ))
  expect(changeValues(receipt, 'seating', 'class_id')).toEqual({
    [classId]: {
      rows: seatingChart.rows, cols: seatingChart.cols, view: seatingChart.perspective,
      seats: seatingChart.grid, objects: seatingChart.objects, custom_objects: seatingChart.customObjects,
    },
  })
}

async function readDefaultChanges(client, classId) {
  const { rows } = await client.query(`
    SELECT 'setting' AS entity, jsonb_build_object('key', s.key) AS key,
      jsonb_build_object('value', s.value) AS value
    FROM ppt.settings_entries s WHERE class_id = $1
    UNION ALL
    SELECT 'rule', jsonb_build_object('rule_id', r.rule_id),
      jsonb_build_object('kind', r.kind, 'event', r.event, 'disabled', r.disabled,
        'name', v.name, 'amount', v.amount, 'icon', v.icon, 'category', v.category)
    FROM ppt.rules r JOIN ppt.rule_versions v USING (class_id, rule_id, rev) WHERE class_id = $1
    UNION ALL
    SELECT 'job', jsonb_build_object('job_id', j.job_id),
      to_jsonb(j) - ARRAY['class_id', 'job_id', 'rev', 'last_op_id', 'origin']
    FROM ppt.jobs j WHERE class_id = $1
    UNION ALL
    SELECT 'product', jsonb_build_object('product_id', p.product_id),
      to_jsonb(p) - ARRAY['class_id', 'product_id', 'rev', 'last_op_id']
    FROM ppt.products p WHERE class_id = $1
    UNION ALL
    SELECT 'seating', jsonb_build_object('class_id', s.class_id), to_jsonb(s) - ARRAY['class_id', 'rev', 'last_op_id']
    FROM ppt.seating s WHERE class_id = $1
  `, [classId])
  return rows
}

async function assertNewClassRows(client, op, actor) {
  const { rows: [row] } = await client.query(`
    SELECT c.*, o.teacher_id FROM ppt.classes c JOIN ppt.class_ownership o USING (class_id)
    WHERE c.class_id = $1
  `, [op.class_id])
  expect(row).toMatchObject({
    teacher_id: actor.id, teacher: op.payload.teacher_name, name: op.payload.name,
    alias: op.payload.alias, school_year: op.payload.school_year, status: 'active',
    rev: 1, class_seq: '1', last_op_id: op.op_id, cutover_date: null,
  })
  const students = await client.query(`
    SELECT s.student_id, s.seat_number, s.name, s.group_key, s.enrollment_status,
      s.rev, a.balance::int, a.total_earned::int
    FROM ppt.students s JOIN ppt.accounts a USING (class_id, student_id)
    WHERE s.class_id = $1 ORDER BY s.seat_number
  `, [op.class_id])
  expect(students.rows).toEqual(op.payload.student_ids.map((id, index) => ({
    student_id: id, seat_number: index + 1, name: `${index + 1}號村民`, group_key: null,
    enrollment_status: 'enrolled', rev: 1, balance: 0, total_earned: 0,
  })))
}

describeDatabase('OP-01 建班', () => {
  const database = useTestDatabase()

  it('建立班級、擁有者、學生與帳戶，依順序回傳新建收據', async () => {
    const { client } = database()
    const { receipt, op, classId, studentIds } = await commitClass(client, createClass(3))
    await assertNewClassRows(client, op, teacher)
    expect(receipt.result.class).toEqual({ class_id: classId, student_count: 3, inherited_from: null })
    expect(receipt.changes.map(({ entity }) => entity)).toEqual([
      'class', ...Array(3).fill('student'), ...Array(3).fill('account'), ...Array(4).fill('setting'),
      ...Array(6).fill('rule'), ...Array(3).fill('job'), ...Array(6).fill('product'), 'seating',
    ])
    for (const change of receipt.changes) {
      expect(change).toMatchObject({ prev_rev: 0, prev_value: null, rev: 1, last_op_id: op.op_id })
    }
    expect(receipt.changes.slice(1, 7).map(change => change.key.student_id)).toEqual([...studentIds, ...studentIds])
    const empty = await commitClass(client, createClass(0))
    await assertNewClassRows(client, empty.op, teacher)
  })

  it('實存的五類預設內容與舊版一致且編號由班級決定', async () => {
    const { client } = database()
    const { receipt, classId } = await commitClass(client, createClass(0, fixedClass))
    assertDefaultRules(receipt, classId)
    assertDefaultResources(receipt, classId)
    expect(await readDefaultChanges(client, classId)).toEqual(expect.arrayContaining(
      receipt.changes.slice(1).map(({ entity, key, value }) => ({ entity, key, value })),
    ))
    const lateId = defaultId(classId, 'rule', 'submission.late')
    expect(lateId).toBe('d6131e7e-63ba-53e6-a3c6-ecd8b7b1746f')
    const { receipt: second, classId: secondId } = await commitClass(client, createClass(0))
    assertDefaultRules(second, secondId)
    expect(changeValues(second, 'rule', 'rule_id')).not.toHaveProperty(lateId)
    const { rows } = await client.query(`
      SELECT r.rule_id, r.disabled, v.effective_at
      FROM ppt.rules r JOIN ppt.rule_versions v USING (class_id, rule_id, rev)
      WHERE r.class_id = $1
    `, [classId])
    expect(rows.map(row => row.rule_id).sort()).toEqual(Object.keys(changeValues(receipt, 'rule', 'rule_id')).sort())
    for (const row of rows) {
      expect(row.disabled).toBe(false)
      expect(row.effective_at.toISOString()).toBe(new Date(receipt.committed_at).toISOString())
    }
  })

  it('建班後可發作業、記缺交、套規則、購買及撤銷，序號連續', async () => {
    const { client } = database()
    const target = await commitClass(client)
    const { classId, studentId } = target
    const task = createTask(classId)
    const taskReceipt = await commitOperation(client, task)
    const missing = operation(classId, 'submission.set_status', {
      task_id: task.payload.task_id, student_id: studentId, status: 'missing',
    }, { rev: 1 })
    const missingReceipt = await commitOperation(client, missing)
    const { rows: [deduction] } = await client.query(
      'SELECT amount::int FROM ppt.transactions WHERE class_id = $1 AND transaction_id = $2',
      [classId, missingReceipt.result.transactions[0]],
    )
    expect(deduction.amount).toBe(DEFAULT_SETTINGS.automation.missingPenalty)
    const applied = await commitOperation(client, operation(classId, 'points.apply_rule', {
      student_id: studentId, rule_id: defaultId(classId, 'rule', 'rule_good_speak'), rule_version: 1,
    }))
    const productId = randomUUID()
    const product = await commitOperation(client, operation(classId, 'product.save', {
      product_id: productId, name: '測試商品', price: 1, price_unit: 'fish', stock: 1, initial_stock: 1,
    }, { rev: 0 }))
    const credit = await commitOperation(client, adjustment(target, 500))
    const bought = await commitOperation(client, purchase({ ...target, productId }, DEFAULT_SETTINGS.currency.tier1.rate))
    const undone = await commitOperation(client, operation(classId, 'op.undo', { target_op_id: missing.op_id }))
    expect([taskReceipt, missingReceipt, applied, product, credit, bought, undone].map(r => r.class_seq))
      .toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('同編號重播原收據，換內容則拒絕且不改資料', async () => {
    const { client } = database()
    const { op, classId, receipt } = await commitClass(client)
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    expect(await submit(client, { ...op, payload: { ...op.payload, name: '測試班二' } }))
      .toMatchObject({ status: 'retry', code: 'OP_ID_REUSED' })
    expect(await operationCount(client)).toBe(count)
    expect(await classSnapshot(client, classId)).toBe(before)
  })

  it.each([
    ['同一位老師', teacher, false, 'ID_CONFLICT', 1],
    ['別的老師', otherTeacher, false, 'CLASS_FORBIDDEN', 0],
    ['同一位老師且班級封存', teacher, true, 'CLASS_ARCHIVED', 1],
  ])('已存在班級由%s再建回 %s', async (_label, actor, archived, code, added) => {
    const { client } = database()
    const { classId } = await commitClass(client)
    if (archived) await commitOperation(client, setClassStatus(classId, 'archived'))
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    expect(await submit(client, createClass(0, classId), actor)).toMatchObject({ code })
    expect(await operationCount(client)).toBe(count + added)
    expect(await classSnapshot(client, classId)).toBe(before)
  })

  it('班級不存在的定案拒絕可重播，可用新編號建班', async () => {
    const { client } = database()
    const bad = createClass(0, randomUUID(), { name: '' })
    const receipt = await submit(client, bad)
    expect(receipt).toMatchObject({ code: 'INVALID_PAYLOAD', status: 'rejected', class_seq: null })
    await expectAbsent(client, bad.class_id, [{ status: 'rejected', code: 'INVALID_PAYLOAD', class_seq: null }])
    expect(await submit(client, bad)).toEqual({ ...receipt, replayed: true })
    expect(await cancel(client, bad.class_id, bad.op_id)).toMatchObject({ code: 'CLASS_FORBIDDEN' })
    await commitClass(client, createClass(0, bad.class_id), otherTeacher)
  })

  it.each([
    ['班級編號不同', op => ({ ...op.payload, class_id: randomUUID() })],
    ['學生人數不符', op => ({ ...op.payload, student_count: 0 })],
    ['學生編號重複', op => ({ ...op.payload, student_count: 2, student_ids: [op.payload.student_ids[0], op.payload.student_ids[0]] })],
    ['學生編號非 v4', op => ({ ...op.payload, student_ids: [fixedClass.replace('-4333-', '-5333-')] })],
    ['學生人數超過上限', op => ({ ...op.payload, student_count: 101 })],
    ['缺班名', op => ({ ...op.payload, name: undefined })],
    ['有多餘鍵', op => ({ ...op.payload, extra: true })],
    ['承接來源是數字', op => ({ ...op.payload, inherit_from_class_id: 1 })],
    ['帶頂層 expect', op => op.payload, { rev: 0 }],
  ])('%s 只保存 INVALID_PAYLOAD', async (_label, change, version) => {
    const { client } = database()
    const op = createClass()
    expect(await submit(client, { ...op, payload: change(op), expect: version })).toMatchObject({
      code: 'INVALID_PAYLOAD', status: 'rejected',
    })
    await expectAbsent(client, op.class_id, [{ status: 'rejected', code: 'INVALID_PAYLOAD', class_seq: null }])
  })

  it('無效操作編號及非老師身分不能建立不存在的班', async () => {
    const { client } = database()
    const op = createClass()
    const v5 = { ...op, op_id: uuidV5(namespace, op.op_id) }
    expect(await submit(client, v5)).toMatchObject({ code: 'INVALID_OP_ID' })
    for (const actor of [scheduler, system]) {
      expect(await submit(client, v5, actor)).toMatchObject({ code: 'CLASS_FORBIDDEN' })
    }
    expect(await agentSubmit(client, op.class_id, [op])).toMatchObject({ code: 'CLASS_FORBIDDEN' })
    await expectAbsent(client, op.class_id, [])
    await commitClass(client, op)
    await authorizeAgent(client, op.class_id)
    const { receipts } = await agentSubmit(client, op.class_id, [createClass(0, op.class_id)])
    expect(receipts[0]).toMatchObject({ code: 'FORBIDDEN_ROLE', status: 'rejected' })
  })

  it('先送離線操作不佔編號，建班後原樣重送成立', async () => {
    const { client } = database()
    const op = createClass()
    const credit = adjustment({ classId: op.class_id, studentId: op.payload.student_ids[0] })
    expect(await submit(client, credit)).toMatchObject({ code: 'CLASS_FORBIDDEN' })
    await expectAbsent(client, op.class_id, [])
    await commitClass(client, op)
    expect(await commitOperation(client, credit)).toMatchObject({ class_seq: 2 })
  })

  it.each([
    ['同一老師使用不同編號', teacher, 'ID_CONFLICT'],
    ['兩位老師使用不同編號', otherTeacher, 'CLASS_FORBIDDEN'],
    ['同一老師重送同一編號', teacher, null],
  ])('%s 並行十次各只建立一份班級資料', async (_label, actor, code) => {
    const { client, connect } = database()
    const second = await connect()
    for (let i = 0; i < 10; i += 1) {
      const op = createClass(0)
      const rival = code ? createClass(0, op.class_id) : op
      const receipts = await Promise.all([submit(client, op), submit(second, rival, actor)])
      const fresh = receipts.filter(r => r.status === 'committed' && !r.replayed)
      expect(fresh).toHaveLength(1)
      if (code) expect(receipts.map(r => r.code).sort()).toEqual([code, 'OK'].sort())
      else expect(receipts.find(r => r.replayed)).toEqual({ ...fresh[0], replayed: true })
      const { rows } = await client.query('SELECT class_seq FROM ppt.classes WHERE class_id = $1', [op.class_id])
      expect(rows).toEqual([{ class_seq: '1' }])
    }
  })

  it('第二位學生寫入異常時全部回復，同編號可重試', async () => {
    const { client } = database()
    const op = createClass(3)
    await client.query(`
      CREATE FUNCTION ppt.fail_class_student() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.seat_number = 2 THEN RAISE EXCEPTION '測試學生寫入失敗'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_class_student BEFORE INSERT ON ppt.students
      FOR EACH ROW EXECUTE FUNCTION ppt.fail_class_student();
    `)
    try {
      await expect(submit(client, op)).rejects.toMatchObject({ code: 'P0001', message: '測試學生寫入失敗' })
      await expectAbsent(client, op.class_id, [])
    } finally {
      await client.query('DROP TRIGGER fail_class_student ON ppt.students; DROP FUNCTION ppt.fail_class_student()')
    }
    await commitClass(client, op)
  })
})
