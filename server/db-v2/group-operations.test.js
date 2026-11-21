import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import {
  assignStudentGroups, groupRow, saveGroup, setStudentEnrollment, studentRow, updateStudentProfile,
} from './test-support/class-student-group.js'
import { addClass, submit, teacher } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function item(studentId, groupKey, version = { rev: 1 }) {
  return { student_id: studentId, group_key: groupKey, expect: version }
}

async function expectGroupRejection(client, op, code) {
  const before = await classSnapshot(client, op.class_id)
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'rejected', code })
  if (code !== 'STALE_STATE') expect(receipt).not.toHaveProperty('current')
  expect(await classSnapshot(client, op.class_id)).toEqual(before)
  return receipt
}

describeDatabase('學生分組與小組存檔', () => {
  const database = useTestDatabase()

  it('OP-08 依輸入順序分組與清除分組，未列學生維持原值', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second, third, fourth] } = await addClass(client, {
      students: ['enrolled', 'enrolled', 'transferred', 'archived'],
    })
    for (const groupKey of ['組甲', '組乙']) {
      await commitOperation(client, saveGroup(classId, { group_key: groupKey }))
    }
    await commitOperation(client, assignStudentGroups(classId, [
      item(first, '組甲'), item(second, '組甲'), item(third, '組甲'),
    ]))
    const before = await studentRow(client, { classId, studentId: fourth })
    const op = assignStudentGroups(classId, [
      item(third, 'unassigned', { rev: 2 }), item(first, '組乙', { rev: 2 }), item(second, '組乙', { rev: 2 }),
    ])
    const receipt = await commitOperation(client, op)

    for (const [index, [studentId, key]] of [[third, null], [first, '組乙'], [second, '組乙']].entries()) {
      expect(receipt.changes[index]).toEqual({
        entity: 'student', key: { student_id: studentId }, prev_rev: 2, rev: 3, last_op_id: op.op_id,
        prev_value: { group_key: '組甲' }, value: { group_key: key },
      })
      expect(await studentRow(client, { classId, studentId })).toMatchObject({ group_key: key, rev: 3 })
    }
    expect(receipt.changes).toHaveLength(3)
    expect(await studentRow(client, { classId, studentId: fourth })).toEqual(before)
  })

  it('OP-08 一項過期整筆回復，現值只列不符的項目與分組資料', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second] } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    await commitOperation(client, saveGroup(classId))
    const change = assignStudentGroups(classId, [item(second, '組甲')])
    const committed = await commitOperation(client, change)

    const op = assignStudentGroups(classId, [item(first, '組甲'), item(second, 'unassigned')])
    const receipt = await expectGroupRejection(client, op, 'STALE_STATE')
    expect(receipt.current).toEqual({
      items: [{
        student_id: second, value: { group_key: '組甲' }, rev: 2, last_op_id: change.op_id,
        actor: teacher, committed_at: committed.committed_at,
      }],
    })
  })

  it('OP-08 依輸入順序回傳全部不符項目，既有學生的 rev 0 也不符', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second, third] } = await addClass(client, {
      students: ['enrolled', 'enrolled', 'enrolled'],
    })
    const receipt = await expectGroupRejection(client, assignStudentGroups(classId, [
      item(third, 'unassigned', { rev: 0 }), item(second, 'unassigned'), item(first, 'unassigned', { rev: 2 }),
    ]), 'STALE_STATE')
    expect(receipt.current.items.map((entry) => entry.student_id)).toEqual([third, first])
  })

  it('OP-08 兩人皆依操作前正確版本通過，僅推進有改動的學生版本', async () => {
    const { client } = database()
    const { classId, studentIds: [first, second] } = await addClass(client, { students: ['enrolled', 'enrolled'] })
    await commitOperation(client, saveGroup(classId))
    const receipt = await commitOperation(client, assignStudentGroups(classId, [
      item(first, '組甲'), item(second, 'unassigned'),
    ]))
    expect(receipt).toMatchObject({
      result: { noop: false }, changes: [{ prev_rev: 1, rev: 2 }, { prev_rev: 1, rev: 1 }],
    })
    const before = await classSnapshot(client, classId, { ignoreClassSequence: true })
    const same = await commitOperation(client, assignStudentGroups(classId, [
      item(first, '組甲', { rev: 2 }), item(second, 'unassigned'),
    ]))
    expect(same).toMatchObject({
      result: { noop: true }, changes: [{ prev_rev: 2, rev: 2 }, { prev_rev: 1, rev: 1 }],
    })
    expect(await classSnapshot(client, classId, { ignoreClassSequence: true })).toEqual(before)
  })

  it.each([
    ['重複學生', (id) => [item(id, '組甲'), item(id, 'unassigned')]],
    ['頂層版本', (id) => [item(id, '組甲')], { rev: 1 }],
    ['頂層空版本', (id) => [item(id, '組甲')], null],
    ['項目無版本', (id) => [{ student_id: id, group_key: '組甲' }]],
    ['項目有兩種版本', (id) => [item(id, '組甲', { rev: 1, after_op: randomUUID() })]],
    ['空清單', () => []],
    ['項目多鍵', (id) => [{ ...item(id, '組甲'), extra: true }]],
    ['空組別', (id) => [item(id, '')]],
    ['超過上限', (id) => Array.from({ length: 201 }, (_, index) => item(id + index, '組甲'))],
  ])('OP-08 拒絕%s', async (_name, makeItems, version) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const op = assignStudentGroups(classId, makeItems(studentId))
    if (version !== undefined) op.expect = version
    await expectGroupRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('OP-08 先檢查每位學生存在，缺少學生優先於版本不符', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    for (const rev of [1, 9]) {
      await expectGroupRejection(client, assignStudentGroups(classId, [
        item(studentId, 'unassigned', { rev }), item(randomUUID(), 'unassigned'),
      ]), 'NOT_FOUND')
    }
  })

  it('OP-08 的項目可承接 OP-05，OP-06 可再承接 OP-08', async () => {
    const { client } = database()
    const target = await addClass(client)
    await commitOperation(client, saveGroup(target.classId))
    const profile = updateStudentProfile(target, { name: '2號村民' })
    await commitOperation(client, profile)
    const groups = assignStudentGroups(target.classId, [item(target.studentId, '組甲', { after_op: profile.op_id })])
    await commitOperation(client, groups)
    const enrollment = setStudentEnrollment(target, 'home_study', { after_op: groups.op_id })
    const receipt = await commitOperation(client, enrollment)
    expect(receipt.changes[0].rev).toBe(4)
  })

  it('OP-09 新建小組、更新組名與組長，既有列拒絕 rev 0', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const create = saveGroup(classId)
    const groupKey = create.payload.group_key
    const created = await commitOperation(client, create)
    expect(created.changes).toEqual([{
      entity: 'group', key: { group_key: groupKey }, prev_rev: 0, rev: 1,
      last_op_id: create.op_id, prev_value: null, value: { name: create.payload.name, leader_student_id: null },
    }])
    await commitOperation(client, assignStudentGroups(classId, [item(studentId, groupKey)]))
    const update = saveGroup(classId, { name: '測試小組乙', leader_student_id: studentId }, { rev: 1 })
    const updated = await commitOperation(client, update)
    expect(updated.changes[0]).toMatchObject({
      prev_rev: 1, rev: 2, value: { name: '測試小組乙', leader_student_id: studentId },
    })
    expect(await groupRow(client, classId, groupKey)).toMatchObject({
      name: '測試小組乙', leader_student_id: studentId, rev: 2, last_op_id: update.op_id,
    })
    const stale = await expectGroupRejection(client, saveGroup(classId), 'STALE_STATE')
    expect(stale.current).toMatchObject({ rev: 2, value: updated.changes[0].value })
    const rename = await commitOperation(client, saveGroup(classId, { name: '測試小組丙' }, { rev: 2 }))
    expect(rename.changes[0].prev_value).toEqual({ name: '測試小組乙' })
    expect(rename.changes[0].value).toEqual({ name: '測試小組丙' })
    expect(await groupRow(client, classId, groupKey)).toMatchObject({ leader_student_id: studentId, rev: 3 })
  })

  it('OP-09 檢查本班組長，接受 JSON null 清除組長', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await expectGroupRejection(client, saveGroup(classId, { leader_student_id: randomUUID() }, { rev: 9 }), 'NOT_FOUND')
    await commitOperation(client, saveGroup(classId))
    await commitOperation(client, assignStudentGroups(classId, [item(studentId, '組甲')]))
    await commitOperation(client, saveGroup(classId, { leader_student_id: studentId }, { rev: 1 }))
    await commitOperation(client, saveGroup(classId, { leader_student_id: null }, { rev: 2 }))
    expect(await groupRow(client, classId, '組甲')).toMatchObject({ leader_student_id: null, rev: 3 })
  })

  it.each([
    ['保留組別', { group_key: 'unassigned' }], ['空組別', { group_key: '' }],
    ['組名過長', { name: '組'.repeat(101) }], ['多鍵', { extra: true }], ['無頂層版本', {}],
  ])('OP-09 拒絕%s', async (name, fields) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = saveGroup(classId, fields)
    if (name === '無頂層版本') delete op.expect
    await expectGroupRejection(client, op, 'INVALID_PAYLOAD')
  })

  it('OP-09 同值成立而版本及最後改動保持原值', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    await commitOperation(client, saveGroup(classId))
    const before = await groupRow(client, classId, '組甲')
    const receipt = await commitOperation(client, saveGroup(classId, {}, { rev: 1 }))
    expect(receipt).toMatchObject({ result: { noop: true }, changes: [{ prev_rev: 1, rev: 1 }] })
    expect(await groupRow(client, classId, '組甲')).toEqual(before)
  })
})
