import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { addClass } from './test-support/operations.js'
import { connectAsRole } from './test-support/roles.js'
import { authorizeScheduler, scheduler } from './test-support/scheduler.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const teacher = { kind: 'teacher', id: '老師編號記號甲' }
const otherTeacher = { kind: 'teacher', id: '老師編號記號乙' }
const system = { kind: 'system', id: 'system' }

async function canAccessClass(client, classId, actor) {
  const { rows: [{ allowed }] } = await client.query(
    'SELECT ppt.can_access_class($1, $2::jsonb) AS allowed', [classId, actor],
  )
  return allowed
}

describeDatabase('網站班級存取檢查', () => {
  const db = useTestDatabase()

  test.each([
    ['老師自己的班', teacher, 'own', true],
    ['別的老師的班', teacher, 'other', false],
    ['有授權的排程', scheduler, 'own', true],
    ['未授權的排程', scheduler, 'other', false],
    ['系統查存在的班', system, 'own', true],
    ['系統查不存在的班', system, 'missing', false],
  ])('%s', async (_label, actor, target, allowed) => {
    const web = await connectAsRole(db(), 'ppt_web')
    const { client } = db()
    const { classId: own } = await addClass(client, { owner: teacher, students: [] })
    const { classId: other } = await addClass(client, { owner: otherTeacher, students: [] })
    await authorizeScheduler(client, own)
    const classIds = { own, other, missing: randomUUID() }
    expect(await canAccessClass(web, classIds[target], actor)).toBe(allowed)
  })

  test.each(['ppt_agent', 'ppt_backup'])('%s 無法執行兩支輔助函式', async (role) => {
    const client = await connectAsRole(db(), role)
    await expect(canAccessClass(client, randomUUID(), system)).rejects.toMatchObject({ code: '42501' })
    await expect(client.query('SELECT ppt.system_actor()')).rejects.toMatchObject({ code: '42501' })
  })
})
