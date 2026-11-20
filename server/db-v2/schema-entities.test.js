import { expect, it } from 'vitest'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { addClass } from './test-support/operations.js'

describeDatabase('乙段資料表', () => {
  const database = useTestDatabase()

  it('事件規則只能有一條啟用，已發行的版本不能改刪', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const insert = `
      WITH rule AS (
        INSERT INTO ppt.rules (class_id, rule_id, kind, event, disabled)
        VALUES ($1,$2,$3,$4,$5) RETURNING class_id, rule_id
      )
      INSERT INTO ppt.rule_versions (class_id, rule_id, rev, name, amount, effective_at)
      SELECT class_id, rule_id, 1, '缺交', -5, clock_timestamp() FROM rule
    `
    const event = 'submission.missing'
    await client.query(insert, [classId, 'rule-1', 'event', event, false])
    await expect(client.query(insert, [classId, 'rule-2', 'event', event, false])).rejects.toMatchObject({ code: '23505' })
    await client.query(insert, [classId, 'rule-2', 'event', event, true])
    await expect(client.query(insert, [classId, 'rule-3', 'event', 'invalid', false])).rejects.toMatchObject({ code: '22P02' })
    await expect(client.query('UPDATE ppt.rule_versions SET amount = 0')).rejects.toMatchObject({ code: '55000' })
    await expect(client.query('DELETE FROM ppt.rule_versions')).rejects.toMatchObject({ code: '55000' })
  })

  it('同一接替鏈或同一學生事件對象只能有一筆有效效果', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    await client.query(`
      INSERT INTO ppt.transactions (class_id, student_id, transaction_id, kind, amount, earned_delta,
        occurred_at, reason, origin, batch_id)
      VALUES ($1,$2,'legacy-tx','legacy_general',0,0,clock_timestamp(),'缺交','migration','fixture')
    `, [classId, studentId])
    const insert = `
      INSERT INTO ppt.effects (class_id, student_id, effect_id, event, subject_kind, subject_key,
        root_transaction_id, status, origin, lineage_id)
      VALUES ($1,$2,$3,'submission.missing','task',$4,'legacy-tx',$5,'legacy',$6)
    `
    await client.query(insert, [classId, studentId, 'effect-1', 'task-1', 'active', 'line-1'])
    await expect(client.query(insert, [classId, studentId, 'effect-2', 'task-2', 'active', 'line-1'])).rejects.toMatchObject({ code: '23505' })
    await expect(client.query(insert, [classId, studentId, 'effect-2', 'task-1', 'active', 'line-2'])).rejects.toMatchObject({ code: '23505' })
    await client.query(insert, [classId, studentId, 'effect-2', 'task-1', 'reversed', 'line-1'])
  })

  it('第二批表接受舊編號及 unknown，繳交用作業與學生唯一定位', async () => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const taskId = 'a'.repeat(64)
    await client.query(`
      INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester)
      VALUES ($1,$2,'作業','作業','2026-11-21','2026-11-22','115-1')
    `, [classId, taskId])
    const insert = `
      INSERT INTO ppt.submissions (class_id, task_id, student_id, status, legacy_status_at_import)
      VALUES ($1,$2,$3,$4,$4) RETURNING rev, basis_rev, assignment_active
    `
    const { rows } = await client.query(insert, [classId, taskId, studentId, 'unknown'])
    expect(rows).toEqual([{ rev: 1, basis_rev: 1, assignment_active: true }])
    await expect(client.query(insert, [classId, taskId, studentId, 'pending'])).rejects.toMatchObject({ code: '23505' })
    await client.query("INSERT INTO ppt.products (class_id, product_id, name, price, price_unit) VALUES ($1,$2,'商品',3,'point')", [classId, 'b'.repeat(64)])
    await client.query("INSERT INTO ppt.settings_entries (class_id, key, value) VALUES ($1,'currency','{}')", [classId])
    const item = await client.query("SELECT status FROM ppt.inventory_items WHERE class_id = $1", [classId])
    expect(item.rows).toEqual([])
  })
})
