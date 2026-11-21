import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { authorizeAgent } from './test-support/agent.js'
import { commitClass, createClass } from './test-support/class-create.js'
import { taipeiDayOffset } from './test-support/correction-rounds.js'
import { addClass, submit } from './test-support/operations.js'
import { connectAsRole } from './test-support/roles.js'
import { overdueOperation, scheduler } from './test-support/scheduler.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const teacher = { kind: 'teacher', id: '老師編號記號甲' }
const schedulerOnly = [{ actor_kind: 'scheduler' }]

async function classAuthorizations(client, classId) {
  const { rows } = await client.query(
    'SELECT actor_kind FROM ppt.class_authorizations WHERE class_id = $1', [classId],
  )
  return rows
}

describeDatabase('新班的排程授權', () => {
  const db = useTestDatabase()

  test('OP-01 新班恰好新增一列排程授權且收據不列授權', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    const { classId, receipt } = await commitClass(web, createClass(1), teacher)
    expect(await classAuthorizations(web, classId)).toEqual(schedulerOnly)
    expect(receipt.changes.map(({ entity }) => entity)).toEqual([
      'class', 'student', 'account', ...Array(4).fill('setting'), ...Array(6).fill('rule'),
      ...Array(3).fill('job'), ...Array(6).fill('product'), 'seating',
    ])
  })

  test('OP-01 承接有小野授權的班仍然只新增排程授權', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    const source = await commitClass(web, createClass(1), teacher)
    await authorizeAgent(db().client, source.classId)
    const op = createClass(1, randomUUID(), { inherit_from_class_id: source.classId })
    const { classId, receipt } = await commitClass(web, op, teacher)
    expect(receipt.result.class.inherited_from).toBe(source.classId)
    expect(await classAuthorizations(web, classId)).toEqual(schedulerOnly)
  })

  test('OP-01 被拒時不替既有同編號的班補排程授權', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    const { classId } = await addClass(db().client, { owner: teacher, students: [] })
    expect(await classAuthorizations(web, classId)).toEqual([])
    const op = createClass(1, classId)
    expect(await submit(web, op, teacher))
      .toMatchObject({ op_id: op.op_id, status: 'rejected', code: 'ID_CONFLICT' })
    expect(await classAuthorizations(web, classId)).toEqual([])
  })

  test('網站排程可直接對剛建的班送 OP-52', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    const { classId } = await commitClass(web, createClass(1), teacher)
    const today = await taipeiDayOffset(web, 0)
    const op = overdueOperation(classId, today)
    expect(await submit(web, op, scheduler)).toMatchObject({
      op_id: op.op_id, status: 'committed', code: 'OK', class_seq: 2,
    })
  })
})
