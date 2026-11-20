import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, retireRule, saveRule } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const importedRuleId = 'a'.repeat(64)

async function importRule(client, classId) {
  await client.query(`
    WITH imported AS (
      INSERT INTO ppt.rules (class_id, rule_id, kind) VALUES ($1, $2, 'manual')
      RETURNING class_id, rule_id
    )
    INSERT INTO ppt.rule_versions (class_id, rule_id, rev, name, amount, effective_at)
    SELECT class_id, rule_id, 1, '舊規則', 2, clock_timestamp() FROM imported
  `, [classId, importedRuleId])
}

describeDatabase('匯入規則編號', () => {
  const database = useTestDatabase()

  test('舊規則可存檔、停用與重啟並保留版本', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    await importRule(client, classId)
    const fields = { rule_id: importedRuleId, name: '舊規則', amount: 7 }
    const updated = await commitOperation(client, saveRule(classId, fields, 1))
    expect(updated.changes).toMatchObject([{ key: { rule_id: importedRuleId }, rev: 2, value: { amount: 7 } }])
    const retired = await commitOperation(client, retireRule(classId, importedRuleId, 2))
    expect(retired.changes).toMatchObject([{ rev: 3, value: { disabled: true } }])
    const enabled = await commitOperation(client, saveRule(classId, fields, 3))
    expect(enabled.changes).toMatchObject([{ rev: 4, value: { disabled: false } }])
    const { rows } = await client.query(`
      SELECT rev, amount::int FROM ppt.rule_versions WHERE class_id = $1 AND rule_id = $2 ORDER BY rev
    `, [classId, importedRuleId])
    expect(rows).toEqual([{ rev: 1, amount: 2 }, { rev: 2, amount: 7 }, { rev: 3, amount: 7 }, { rev: 4, amount: 7 }])
  })

  test('新建拒絕舊格式編號，先檢查本班版本且不影響另一班', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const { classId: otherClass } = await addClass(client)
    const fields = { rule_id: importedRuleId }
    expect(await submit(client, saveRule(classId, fields, 1))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 0 },
    })
    expect(await submit(client, saveRule(classId, fields))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    await importRule(client, otherClass)
    const before = await classSnapshot(client, otherClass)
    expect(await submit(client, saveRule(classId, fields))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(await classSnapshot(client, otherClass)).toBe(before)
    const { rows } = await client.query('SELECT * FROM ppt.rules WHERE class_id = $1', [classId])
    expect(rows).toEqual([])
  })
})
