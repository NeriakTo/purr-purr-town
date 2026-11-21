import { expect, test } from 'vitest'
import { backfillSchedulerAuthorizations } from './test-support/backfill-scheduler-authorizations.js'
import { taipeiDayOffset } from './test-support/correction-rounds.js'
import { addClass, submit } from './test-support/operations.js'
import { connectAsRole } from './test-support/roles.js'
import { authorizeScheduler, overdueOperation, scheduler } from './test-support/scheduler.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const teacher = { kind: 'teacher', id: '老師編號記號甲' }

async function authorizationRows(client) {
  const { rows } = await client.query(`
    SELECT class_id, actor_kind FROM ppt.class_authorizations
    ORDER BY class_id COLLATE "C", actor_kind
  `)
  return rows
}

describeDatabase('匯入班級的排程授權補登', () => {
  const db = useTestDatabase()

  test('擁有者只補缺的排程授權且重跑後網站排程可寫入', async () => {
    const [owner, web] = await Promise.all([
      connectAsRole(db(), 'ppt_owner'), connectAsRole(db(), 'ppt_web'),
    ])
    const imported = await addClass(owner, { owner: teacher, students: [] })
    const archived = await addClass(owner, { owner: teacher, status: 'archived', students: [] })
    const existing = await addClass(owner, { owner: teacher, students: [] })
    await authorizeScheduler(owner, existing.classId)
    expect(await authorizationRows(owner)).toEqual([{ class_id: existing.classId, actor_kind: 'scheduler' }])
    const expected = [imported.classId, archived.classId, existing.classId].sort()
      .map(class_id => ({ class_id, actor_kind: 'scheduler' }))

    expect((await backfillSchedulerAuthorizations(owner)).rowCount).toBe(2)
    expect(await authorizationRows(owner)).toEqual(expected)
    expect((await backfillSchedulerAuthorizations(owner)).rowCount).toBe(0)
    expect(await authorizationRows(owner)).toEqual(expected)

    const today = await taipeiDayOffset(web, 0)
    const op = overdueOperation(imported.classId, today)
    expect(await submit(web, op, scheduler)).toMatchObject({ status: 'committed', code: 'OK', class_seq: 1 })
    const { rows } = await web.query(`
      SELECT op_id, actor_kind, actor_id, status FROM ppt.operations WHERE class_id = $1
    `, [imported.classId])
    expect(rows).toEqual([{ op_id: op.op_id, actor_kind: 'scheduler', actor_id: 'scheduler', status: 'committed' }])
  })

  test('網站角色執行補登檔時收到 42501', async () => {
    const web = await connectAsRole(db(), 'ppt_web')
    await expect(backfillSchedulerAuthorizations(web)).rejects.toMatchObject({ code: '42501' })
  })
})
