import { expect, it } from 'vitest'
import { classRow, groupRow, studentRow } from './test-support/class-student-group.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass } from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('班級、學生與小組資料表', () => {
  const database = useTestDatabase()

  it('既有支架可省略新欄位，初始版本仍為一', async () => {
    const { client } = database()
    const target = await addClass(client)

    expect(await classRow(client, target.classId)).toMatchObject({
      school_year: null, name: null, teacher: null, alias: null, rev: 1,
    })
    expect(await studentRow(client, target)).toMatchObject({ avatar: null, rev: 1 })
  })

  it('班級快照各自收錄班名、頭像與小組', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const before = await classSnapshot(client, classId)

    await client.query('UPDATE ppt.classes SET name = $2 WHERE class_id = $1', [classId, '測試班'])
    const named = await classSnapshot(client, classId)
    expect(named).not.toEqual(before)

    await client.query(
      'UPDATE ppt.students SET avatar = to_jsonb($3::text) WHERE class_id = $1 AND student_id = $2',
      [classId, studentId, '測試頭像'],
    )
    const withAvatar = await classSnapshot(client, classId)
    expect(withAvatar).not.toEqual(named)

    await client.query(
      'INSERT INTO ppt.groups (class_id, group_key, name) VALUES ($1, $2, $3)',
      [classId, '組甲', '測試小組'],
    )
    expect(await classSnapshot(client, classId)).not.toEqual(withAvatar)
    expect(await groupRow(client, classId, '組甲')).toMatchObject({ leader_student_id: null, rev: 1 })
  })
})
