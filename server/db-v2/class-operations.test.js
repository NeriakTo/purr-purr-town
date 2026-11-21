import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classInfo, classRow, setClassStatus, updateClassInfo } from './test-support/class-student-group.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, adjustment, cancel, submit, teacher } from './test-support/operations.js'
import { commitOperation, createTask } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { setStatus } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('班級資訊與封存', () => {
  const database = useTestDatabase()

  it('OP-02 整份寫入班級資訊與前後值，推進版本和序號', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = updateClassInfo(classId)
    const receipt = await commitOperation(client, op)

    expect(await classRow(client, classId)).toMatchObject({
      name: classInfo.name, alias: classInfo.alias, teacher: classInfo.teacher_name,
      school_year: classInfo.school_year, rev: 2, last_op_id: op.op_id, class_seq: '1',
    })
    expect(receipt.class_seq).toBe(1)
    expect(receipt.changes).toEqual([{
      entity: 'class', key: { class_id: classId }, prev_rev: 1, rev: 2, last_op_id: op.op_id,
      prev_value: { name: null, alias: null, teacher_name: null, school_year: null }, value: classInfo,
    }])
  })

  it('OP-02 同值保留資料版本與最後改動，仍取得下一個序號', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const original = updateClassInfo(classId)
    await commitOperation(client, original)
    const receipt = await commitOperation(client, updateClassInfo(classId, classInfo, { rev: 2 }))

    expect(receipt).toMatchObject({ class_seq: 2, result: { noop: true } })
    expect(receipt.changes).toMatchObject([{ prev_rev: 2, rev: 2 }])
    expect(await classRow(client, classId)).toMatchObject({ rev: 2, last_op_id: original.op_id })
  })

  it('OP-02 過期回五欄班級現值及原操作資料，班級列保持原值', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const update = updateClassInfo(classId)
    const committed = await commitOperation(client, update)
    const before = await classRow(client, classId)

    const receipt = await submit(client, updateClassInfo(classId, { ...classInfo, name: '測試班乙' }))
    expect(receipt.code).toBe('STALE_STATE')
    expect(receipt.current).toEqual({
      value: { ...classInfo, status: 'active' }, rev: 2, last_op_id: update.op_id,
      actor: teacher, committed_at: committed.committed_at,
    })
    expect(await classRow(client, classId)).toEqual(before)
  })

  it.each([
    ['少鍵', { school_year: undefined }, { rev: 1 }],
    ['多鍵', { extra: true }, { rev: 1 }],
    ['空班名', { name: '' }, { rev: 1 }],
    ['班名過長', { name: '班'.repeat(101) }, { rev: 1 }],
    ['別名型別錯誤', { alias: 2 }, { rev: 1 }],
    ['省略版本', {}, undefined],
    ['空版本', {}, null],
  ])('OP-02 拒絕%s', async (_name, fields, version) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = updateClassInfo(classId, { ...classInfo, ...fields }, version)
    if (version === undefined) delete op.expect
    expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('OP-02 班級已存在時 rev 0 回版本過期', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    expect(await submit(client, updateClassInfo(classId, classInfo, { rev: 0 }))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 1 },
    })
  })

  it.each([
    ['OP-24', (target) => adjustment(target)],
    ['OP-14', (target) => setStatus(target, 'missing')],
    ['OP-43', ({ classId }) => setSetting(classId, 'taskTypes', ['作業'])],
    ['OP-02', ({ classId }) => updateClassInfo(classId)],
    ['小野 OP-14', (target) => setStatus(target, 'missing'), true],
  ])('OP-03 封存後阻擋%s，班級快照保持原值', async (_name, makeOp, viaAgent) => {
    const { client } = database()
    const target = await addClass(client)
    const task = createTask(target.classId)
    await commitOperation(client, task)
    if (viaAgent) await authorizeAgent(client, target.classId)
    const archive = setClassStatus(target.classId, 'archived')
    const archived = await commitOperation(client, archive)
    expect(archived.changes).toMatchObject([{
      entity: 'class', prev_value: { status: 'active' }, value: { status: 'archived' }, rev: 2,
    }])
    expect(await classRow(client, target.classId)).toMatchObject({ status: 'archived' })
    const before = await classSnapshot(client, target.classId)
    const op = makeOp({ ...target, taskId: task.payload.task_id })
    const receipt = viaAgent
      ? (await agentSubmit(client, target.classId, [op])).receipts[0]
      : await submit(client, op)

    expect(receipt).toMatchObject({ status: 'rejected', code: 'CLASS_ARCHIVED' })
    expect(await classSnapshot(client, target.classId)).toEqual(before)
  })

  it('OP-03 解除封存後可對同一學生加點', async () => {
    const { client } = database()
    const target = await addClass(client)
    const archived = setClassStatus(target.classId, 'archived')
    await commitOperation(client, archived)
    await commitOperation(client, setClassStatus(target.classId, 'active', { after_op: archived.op_id }))
    await commitOperation(client, adjustment(target, 1))
    expect(await classRow(client, target.classId)).toMatchObject({ status: 'active', rev: 3, class_seq: '3' })
  })

  it.each(['active', 'archived'])('OP-03 %s 同值成立且保留版本', async (status) => {
    const { client } = database()
    const { classId } = await addClass(client, { status })
    const receipt = await commitOperation(client, setClassStatus(classId, status))
    expect(receipt).toMatchObject({ result: { noop: true }, class_seq: 1 })
    expect(await classRow(client, classId)).toMatchObject({ status, rev: 1, last_op_id: null })
  })

  it.each(['active', 'archived'])('OP-03 %s 班照樣檢查過期版本', async (status) => {
    const { client } = database()
    const { classId } = await addClass(client, { status })
    expect(await submit(client, setClassStatus(classId, 'active', { rev: 2 }))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 1, value: { status } },
    })
  })

  it.each(['未知狀態', '多鍵', '省略版本'])('OP-03 拒絕%s', async (name) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = setClassStatus(classId, 'active')
    if (name === '未知狀態') op.payload.status = 'closed'
    if (name === '多鍵') op.payload.extra = true
    if (name === '省略版本') delete op.expect
    expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('OP-02 與 OP-03 共用版本，OP-24 只推進班級序號', async () => {
    const { client } = database()
    const target = await addClass(client)
    const update = updateClassInfo(target.classId)
    await commitOperation(client, update)
    expect(await submit(client, setClassStatus(target.classId, 'archived'))).toMatchObject({ code: 'STALE_STATE' })
    const archived = setClassStatus(target.classId, 'archived', { after_op: update.op_id })
    await commitOperation(client, archived)
    await commitOperation(client, setClassStatus(target.classId, 'active', { after_op: archived.op_id }))
    const before = await classRow(client, target.classId)
    await commitOperation(client, adjustment(target, 1))
    expect(await classRow(client, target.classId)).toEqual({ ...before, class_seq: '4' })
  })

  it('封存班仍可登記放棄', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    await commitOperation(client, setClassStatus(classId, 'archived'))
    expect(await cancel(client, classId, randomUUID())).toMatchObject({ status: 'cancelled' })
  })

  it('十次雙連線競爭加點只會先於封存成立或被封存擋下', async () => {
    const { client, connect } = database()
    const other = await connect()
    for (let index = 0; index < 10; index += 1) {
      const target = await addClass(client)
      const archive = setClassStatus(target.classId, 'archived')
      const addPoints = adjustment(target, 1)
      const requests = index % 2 === 0
        ? [submit(client, archive), submit(other, addPoints)]
        : [submit(other, addPoints), submit(client, archive)].reverse()
      const [archived, adjusted] = await Promise.all(requests)
      expect(archived).toMatchObject({ status: 'committed', code: 'OK' })
      if (adjusted.status === 'committed') {
        expect(adjusted.class_seq).toBeLessThan(archived.class_seq)
      } else {
        expect(adjusted).toMatchObject({ status: 'rejected', code: 'CLASS_ARCHIVED' })
      }
    }
  })
})
