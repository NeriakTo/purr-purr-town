import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { semesterAt } from '../migration/convert.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, createTask, saveRule, updateTask } from './test-support/schoolwork.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function unchangedByTaskUpdate(client, classId) {
  const { rows } = await client.query(`
    SELECT
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY transaction_id) FROM ppt.transactions AS t WHERE class_id = $1) AS transactions,
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY effect_id) FROM ppt.effects AS e WHERE class_id = $1) AS effects,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY task_id, student_id) FROM ppt.submissions AS s WHERE class_id = $1) AS submissions
  `, [classId])
  return rows[0]
}

describeDatabase('OP-10 與 OP-11', () => {
  const database = useTestDatabase()

  test('學期月份規則與轉換器一致', async () => {
    const { client } = database()
    const dates = {
      '2026-11-21': '115-1', '2027-01-15': '115-1', '2027-02-01': '115-2',
      '2026-07-31': '114-2', '2026-08-01': '115-1', '2028-02-29': '116-2',
    }
    for (const [date, expected] of Object.entries(dates)) {
      const { rows: [{ semester }] } = await client.query('SELECT ppt.semester_at($1::date) AS semester', [date])
      expect(semester).toBe(expected)
      expect(semester).toBe(semesterAt(date))
    }
  })

  test('預設指派在學學生，明列可含在家自學', async () => {
    const { client } = database()
    const { classId, studentIds: [enrolled, home] } = await addClass(client, {
      students: ['enrolled', 'home_study', 'transferred'],
    })
    const automatic = await commitOperation(client, createTask(classId))
    expect(automatic.changes.slice(1).map(change => change.key.student_id)).toEqual([enrolled])
    const explicit = await commitOperation(client, createTask(classId, { assignee_ids: [home, enrolled] }))
    expect(explicit.changes.slice(1).map(change => change.key.student_id)).toEqual([enrolled, home])
  })

  test('名單依不存在、停用與輸入形狀回覆，重複作業編號最後檢查', async () => {
    const { client } = database()
    const { classId, studentIds: [enrolled, transferred] } = await addClass(client, {
      students: ['enrolled', 'transferred'],
    })
    const other = await addClass(client)
    const first = createTask(classId)
    await commitOperation(client, first)
    for (const [assignee_ids, code] of [
      [[transferred, other.studentId], 'NOT_FOUND'],
      [[transferred], 'ENTITY_INACTIVE'],
      [[enrolled, enrolled], 'INVALID_PAYLOAD'],
      [[], 'INVALID_PAYLOAD'],
      [[enrolled], 'ID_CONFLICT'],
    ]) {
      expect(await submit(client, createTask(classId, { task_id: first.payload.task_id, assignee_ids }))).toMatchObject({ code })
    }
  })

  test('不存在的日期定案拒絕且留一列操作紀錄', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = createTask(classId, { due_on: '2026-02-30' })
    const receipt = await submit(client, op)
    expect(receipt).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
    const { rows } = await client.query('SELECT receipt FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(rows).toEqual([{ receipt }])
  })

  test('自動免交比對標題大小寫、類型與非空關鍵字', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client, { students: ['enrolled', 'enrolled', 'enrolled'] })
    const rules = [
      [{ keyword: 'MaTH', taskType: '作業' }],
      [{ keyword: 'MaTH', taskType: '訂正' }],
      [{ keyword: '', taskType: '作業' }],
    ]
    for (const [index, studentId] of studentIds.entries()) {
      await client.query('UPDATE ppt.students SET exempt_rules = $3 WHERE class_id = $1 AND student_id = $2',
        [classId, studentId, JSON.stringify(rules[index])])
    }
    const receipt = await commitOperation(client, createTask(classId, { title: 'math 練習' }))
    expect(receipt.changes.slice(1).map(change => change.value.status)).toEqual(['exempt', 'pending', 'pending'])
    expect(receipt.result).toMatchObject({ transactions: [], effects_added: [], effects_reversed: [] })
  })

  test('作業與各筆初始繳交都有版本收據，重送不多建', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    const op = createTask(classId, { page_text: '第 5 頁' })
    const taskId = op.payload.task_id
    const receipt = await commitOperation(client, op)
    expect(receipt.changes).toEqual([{
      entity: 'task', key: { task_id: taskId }, prev_rev: 0, rev: 1,
      prev_value: null, value: {
        title: '測試作業', task_type: '作業', page_text: '第 5 頁', published_on: '2026-11-21',
        due_on: '2026-11-22', semester: '115-1', voided: false,
      }, last_op_id: op.op_id,
    }, ...studentIds.map(studentId => ({
      entity: 'submission', key: { task_id: taskId, student_id: studentId }, prev_rev: 0, rev: 1,
      prev_basis_rev: 0, basis_rev: 1, prev_value: null,
      value: { status: 'pending', assignment_active: true }, last_op_id: op.op_id,
    }))])
    expect(await submit(client, op)).toEqual({ ...receipt, replayed: true })
    const { rows } = await client.query('SELECT student_id FROM ppt.submissions WHERE class_id = $1 AND task_id = $2', [classId, taskId])
    expect(rows.map(row => row.student_id).sort()).toEqual([...studentIds].sort())
  })

  test('更新只列實際改動欄位，改期限不動繳交與帳目', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const create = createTask(classId, { page_text: '第 5 頁' })
    await commitOperation(client, create)
    const taskId = create.payload.task_id
    await commitOperation(client, saveRule(classId, { kind: 'event', event: 'submission.missing', amount: -5 }))
    await commitOperation(client, setStatus({ classId, taskId, studentId }, 'missing'))
    const before = await unchangedByTaskUpdate(client, classId)
    const rename = updateTask(classId, taskId, { title: '改名作業', task_type: '作業' })
    const renamed = await commitOperation(client, rename)
    expect(renamed.changes).toEqual([{
      entity: 'task', key: { task_id: taskId }, prev_rev: 1, rev: 2, last_op_id: rename.op_id,
      prev_value: { title: '測試作業' }, value: { title: '改名作業' },
    }])
    const deadline = await commitOperation(client, updateTask(classId, taskId, {
      due_on: '2026-11-23', page_text: null,
    }, { after_op: rename.op_id }))
    expect(deadline.changes[0]).toMatchObject({ rev: 3, value: { due_on: '2026-11-23', page_text: null } })
    expect(await unchangedByTaskUpdate(client, classId)).toEqual(before)
    expect(await submit(client, updateTask(classId, taskId, { title: '改名作業' }))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 3, value: { title: '改名作業', due_on: '2026-11-23' } },
    })
    expect(await commitOperation(client, updateTask(classId, taskId, { title: '改名作業' }, { rev: 3 })))
      .toMatchObject({ result: { noop: true }, changes: [{ prev_rev: 3, rev: 3 }] })
    expect(await submit(client, updateTask(classId, taskId, { published_on: '2026-11-23' }, { rev: 3 })))
      .toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(await submit(client, updateTask(classId, randomUUID(), { title: '另一份作業' }, { rev: 3 })))
      .toMatchObject({ code: 'NOT_FOUND' })
  })
})
