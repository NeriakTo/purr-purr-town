import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import {
  addStudentOperation, assignStudentGroups, saveGroup, setClassStatus, setStudentEnrollment,
  setStudentExemptRules, studentRow, updateClassInfo, updateStudentProfile,
} from './test-support/class-student-group.js'
import { addClass, classSequence, operationCount, submit } from './test-support/operations.js'
import { authorizeScheduler, scheduledId, scheduler } from './test-support/scheduler.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function groupAssignment({ classId, studentId }) {
  return assignStudentGroups(classId, [{ student_id: studentId, group_key: 'unassigned', expect: { rev: 1 } }])
}

const cases = [
  ['OP-02', ({ classId }) => updateClassInfo(classId)],
  ['OP-03', ({ classId }) => setClassStatus(classId, 'active')],
  ['OP-04', ({ classId }) => addStudentOperation(classId)],
  ['OP-05', (target) => updateStudentProfile(target, { name: '2號村民' })],
  ['OP-06', (target) => setStudentEnrollment(target, 'home_study')],
  ['OP-07', (target) => setStudentExemptRules(target, [])],
  ['OP-08', groupAssignment],
  ['OP-09', ({ classId }) => saveGroup(classId)],
]

async function expectFinalRejection(client, op, code, send) {
  const before = await classSnapshot(client, op.class_id)
  const count = await operationCount(client)
  const receipt = await send()
  expect(receipt).toMatchObject({ status: 'rejected', code, class_seq: null })
  expect(receipt).not.toHaveProperty('current')
  expect(await operationCount(client)).toBe(count + 1)
  const { rows } = await client.query(
    'SELECT status, class_seq, receipt FROM ppt.operations WHERE class_id = $1 AND op_id = $2',
    [op.class_id, op.op_id],
  )
  expect(rows).toEqual([{ status: 'rejected', class_seq: null, receipt }])
  expect(await classSnapshot(client, op.class_id)).toEqual(before)
}

it('README 的班級、學生與小組表逐一列出八種操作', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8')
  const section = readme.split('## 班級、學生與小組\n')[1]?.split('\n## ')[0] ?? ''
  const documented = [...section.matchAll(/^\| (OP-\d+) `([^`]+)`/gm)].map(([, id, type]) => [id, type])
  expect(documented).toEqual(cases.map(([id, makeOp]) => [id, makeOp({}).type]))
})

describeDatabase('甲段班級寫入驗收', () => {
  const database = useTestDatabase()

  it.each(cases)('%s 拒絕小野及排程，並遵守封存閘門', async (id, makeOp) => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    await authorizeScheduler(client, target.classId)
    const agentOp = makeOp(target)
    await expectFinalRejection(client, agentOp, 'FORBIDDEN_ROLE', async () => {
      const { receipts: [receipt] } = await agentSubmit(client, target.classId, [agentOp])
      return receipt
    })

    const schedulerOp = { ...makeOp(target), op_id: scheduledId(target.classId, '2026-11-21') }
    await expectFinalRejection(
      client, schedulerOp, 'FORBIDDEN_ROLE', () => submit(client, schedulerOp, scheduler),
    )

    const archived = setClassStatus(target.classId, 'archived')
    await commitOperation(client, archived)
    if (id === 'OP-03') {
      const active = setClassStatus(target.classId, 'active', { after_op: archived.op_id })
      await commitOperation(client, active)
    } else {
      const op = makeOp(target)
      await expectFinalRejection(client, op, 'CLASS_ARCHIVED', () => submit(client, op))
    }
  })

  it.each([
    ...cases.slice(3, 7),
    ['OP-09', ({ classId, studentId }) => saveGroup(classId, { leader_student_id: studentId })],
  ])('%s 同一老師跨班找不到學生，來源班快照保持原值', async (_id, makeOp) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const source = await addClass(client)
    const before = await classSnapshot(client, source.classId)
    const op = makeOp({ classId, studentId: source.studentId })
    await expectFinalRejection(client, op, 'NOT_FOUND', () => submit(client, op))
    expect(await classSnapshot(client, source.classId)).toEqual(before)
  })

  it('十次同版本雙連線競爭 OP-05 與 OP-06，每輪恰一筆成立', async () => {
    const { client, connect } = database()
    const other = await connect()
    for (let index = 0; index < 10; index += 1) {
      const target = await addClass(client)
      const update = updateStudentProfile(target, { name: '2號村民' })
      const enrollment = setStudentEnrollment(target, 'home_study')
      const [profile, status] = await Promise.all([submit(client, update), submit(other, enrollment)])
      expect([profile.code, status.code].sort()).toEqual(['OK', 'STALE_STATE'])

      const profileWon = profile.code === 'OK'
      const winner = profileWon ? update : enrollment
      const stale = profileWon ? status : profile
      expect(stale).toMatchObject({ status: 'rejected', current: { rev: 2, last_op_id: winner.op_id } })
      expect(await studentRow(client, target)).toMatchObject({
        name: profileWon ? '2號村民' : '1號村民',
        enrollment_status: profileWon ? 'enrolled' : 'home_study',
        rev: 2, last_op_id: winner.op_id,
      })
      expect(await classSequence(client, target.classId)).toBe(1)
    }
  })
})
