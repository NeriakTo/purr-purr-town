import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { addImportedJob, assignJob, retireJob, saveJob } from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function jobRow(client, classId, jobId) {
  const { rows: [job] } = await client.query(
    'SELECT to_jsonb(j) AS value FROM ppt.jobs j WHERE class_id = $1 AND job_id = $2', [classId, jobId],
  )
  return job?.value
}

async function expectRejection(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}

describeDatabase('職務操作', () => {
  const database = useTestDatabase()

  it('新建、存檔同值及版本條件使用完整職務快照', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = saveJob(classId)
    const jobId = op.payload.job_id
    const value = {
      title: '圖書股長', salary: 10, icon: null, cycle: 'monthly', category: null, disabled: false, assignee_ids: [],
    }
    const created = await commitOperation(client, op)
    expect(created).toMatchObject({ class_seq: 1, result: { noop: false, transactions: [] } })
    expect(created.changes).toEqual([{
      entity: 'job', key: { job_id: jobId }, prev_rev: 0, rev: 1, last_op_id: op.op_id, prev_value: null, value,
    }])
    expect(await jobRow(client, classId, jobId)).toMatchObject({ ...value, origin: 'op', rev: 1 })
    const edit = saveJob(classId, { job_id: jobId, salary: 12 }, { after_op: op.op_id })
    const updated = await commitOperation(client, edit)
    expect(updated.changes[0]).toMatchObject({ prev_value: value, value: { ...value, salary: 12 }, rev: 2 })
    const unchanged = await commitOperation(client,
      saveJob(classId, edit.payload, { after_op: edit.op_id }))
    expect(unchanged).toMatchObject({ class_seq: 3, result: { noop: true }, changes: [{ rev: 2 }] })
    expect(await jobRow(client, classId, jobId)).toMatchObject({ rev: 2, last_op_id: edit.op_id })
    const stale = await expectRejection(client, saveJob(classId, op.payload, { rev: 1 }), 'STALE_STATE')
    expect(stale.current.value).toEqual({ ...value, salary: 12 })
  })

  it('新建在版本後才驗編號，更新匯入職務保留來源與名單', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const jobId = 'a'.repeat(64)
    await expectRejection(client, saveJob(classId, { job_id: jobId }), 'INVALID_PAYLOAD')
    const stale = await expectRejection(client, saveJob(classId, { job_id: jobId }, { rev: 1 }), 'STALE_STATE')
    expect(stale.current).toMatchObject({ rev: 0, value: null })
    await addImportedJob(client, classId, { jobId, assigneeIds: [studentId] })
    await commitOperation(client, saveJob(classId, { job_id: jobId }, { rev: 1 }))
    expect(await jobRow(client, classId, jobId)).toMatchObject({
      origin: 'migration', assignee_ids: [studentId], title: '圖書股長', rev: 2,
    })
  })

  it.each([
    ['缺少編號', { job_id: undefined }], ['空職稱', { title: '' }], ['職稱過長', { title: '職'.repeat(101) }],
    ['小數薪資', { salary: 1.5 }], ['負薪資', { salary: -1 }], ['薪資過高', { salary: 100001 }],
    ['薪資字串', { salary: '10' }], ['未知週期', { cycle: 'yearly' }], ['圖示型別', { icon: false }],
    ['分類型別', { category: null }], ['指派鍵', { assignee_ids: [] }], ['停用鍵', { disabled: false }],
    ['來源鍵', { origin: 'op' }], ['未知鍵', { extra: 0 }], ['無 expect', {}, undefined],
    ['空 expect', {}, null], ['兩種 expect', {}, { rev: 0, after_op: 'old' }],
  ])('OP-35 拒絕%s', async (_label, fields, ...versions) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = saveJob(classId, fields)
    if (versions.length) op.expect = versions[0]
    await expectRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('停用保留名單和版本，同值停用可串接重新啟用', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const create = saveJob(classId)
    const jobId = create.payload.job_id
    await commitOperation(client, create)
    await commitOperation(client, assignJob(classId, jobId, [studentId]))
    const retired = await commitOperation(client, retireJob(classId, jobId, { rev: 2 }))
    expect(retired.changes[0]).toMatchObject({ rev: 3, value: { disabled: true, assignee_ids: [studentId] } })
    const repeated = await commitOperation(client, retireJob(classId, jobId, { rev: 3 }))
    expect(repeated).toMatchObject({ result: { noop: true }, changes: [{ rev: 3 }] })
    expect(await jobRow(client, classId, jobId)).toMatchObject({ last_op_id: retired.op_id })
    const restored = await commitOperation(client, saveJob(classId, create.payload, { after_op: repeated.op_id }))
    expect(restored.changes[0]).toMatchObject({ rev: 4, value: { disabled: false, assignee_ids: [studentId] } })
    expect(await expectRejection(client, retireJob(classId, randomUUID()), 'NOT_FOUND')).not.toHaveProperty('current')
    await expectRejection(client, retireJob(classId, jobId, { rev: 3 }), 'STALE_STATE')
    const malformed = retireJob(classId, jobId)
    malformed.payload.extra = true
    await expectRejection(client, malformed, 'INVALID_PAYLOAD')
  })

  it('整份指派保留順序與在學狀態無關，並共享職務版本', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client, { students: ['enrolled', 'home_study', 'transferred'] })
    const create = saveJob(classId)
    const jobId = create.payload.job_id
    await commitOperation(client, create)
    const assigned = await commitOperation(client, assignJob(classId, jobId, studentIds))
    expect(assigned.changes[0]).toMatchObject({
      rev: 2, prev_value: { assignee_ids: [] }, value: { assignee_ids: studentIds },
    })
    const repeated = await commitOperation(client, assignJob(classId, jobId, studentIds, { rev: 2 }))
    expect(repeated).toMatchObject({ result: { noop: true }, changes: [{ rev: 2 }] })
    const reversed = [...studentIds].reverse()
    const reordered = await commitOperation(client, assignJob(classId, jobId, reversed, { rev: 2 }))
    expect(reordered.changes[0]).toMatchObject({ rev: 3, value: { assignee_ids: reversed } })
    const edited = await commitOperation(client, saveJob(classId, { ...create.payload, title: '衛生股長' }, { rev: 3 }))
    expect(edited.changes[0]).toMatchObject({ rev: 4, value: { title: '衛生股長', assignee_ids: reversed } })
    await expectRejection(client, assignJob(classId, jobId, [], { rev: 3 }), 'STALE_STATE')
    const cleared = await commitOperation(client, assignJob(classId, jobId, [], { after_op: edited.op_id }))
    expect(cleared.changes[0]).toMatchObject({ rev: 5, value: { assignee_ids: [] } })
  })

  it.each([
    ['非陣列', 'INVALID_PAYLOAD', () => ({ ids: {} })],
    ['重複學生', 'INVALID_PAYLOAD', (studentId) => ({ ids: [studentId, studentId] })],
    ['空學生編號', 'INVALID_PAYLOAD', () => ({ ids: [''] })],
    ['職務不存在兼版本不符', 'NOT_FOUND', () => ({ missing: true })],
    ['學生不存在', 'NOT_FOUND', () => ({ ids: [randomUUID()] })],
    ['職務停用兼版本不符', 'ENTITY_INACTIVE', () => ({ disabled: true })],
    ['版本不符', 'STALE_STATE', () => ({})],
  ])('OP-37 拒絕%s', async (_label, code, scenario) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const create = saveJob(classId)
    const jobId = create.payload.job_id
    await commitOperation(client, create)
    const { ids = [studentId], missing, disabled } = scenario(studentId)
    if (disabled) await commitOperation(client, retireJob(classId, jobId))
    await expectRejection(client, assignJob(classId, missing ? randomUUID() : jobId, ids, { rev: 99 }), code)
  })

  it.each([saveJob, retireJob, assignJob])('職務操作只供未封存班的老師呼叫 %#', async (makeOp) => {
    const { client } = database()
    const { classId } = await addClass(client)
    await authorizeAgent(client, classId)
    const { class_id: _classId, ...entry } = makeOp(classId)
    const { receipts: [receipt] } = await agentSubmit(client, classId, [entry])
    expect(receipt.code).toBe('FORBIDDEN_ROLE')
    const archived = await addClass(client, { status: 'archived' })
    await expectRejection(client, makeOp(archived.classId), 'CLASS_ARCHIVED')
  })
})
