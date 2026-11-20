import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, retireRule, saveRule } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function ruleVersions(client, classId, ruleId) {
  const { rows } = await client.query(`
    SELECT rev, name, amount::int, icon, category, effective_at
    FROM ppt.rule_versions WHERE class_id = $1 AND rule_id = $2 ORDER BY rev
  `, [classId, ruleId])
  return rows
}

describeDatabase('OP-38 與 OP-39', () => {
  const database = useTestDatabase()

  test.each([['manual', undefined], ['event', 'submission.missing']])('%s 規則新建並保留舊版本', async (kind, event) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const create = saveRule(classId, { kind, event, icon: '☆', category: '測試' })
    const { rule_id: ruleId } = create.payload
    const first = await commitOperation(client, create)
    expect(first.changes).toEqual([{
      entity: 'rule', key: { rule_id: ruleId }, prev_rev: 0, rev: 1,
      last_op_id: create.op_id, prev_value: null,
      value: { kind, event: event ?? null, disabled: false, name: '試用規則', amount: 5, icon: '☆', category: '測試' },
    }])
    const versions = await ruleVersions(client, classId, ruleId)
    expect(versions[0].effective_at).toEqual(new Date(first.committed_at))
    const change = await commitOperation(client, saveRule(classId, { ...create.payload, amount: -7 }, 1))
    expect(change.changes[0]).toMatchObject({ prev_rev: 1, rev: 2, value: { amount: -7 } })
    expect(await ruleVersions(client, classId, ruleId)).toEqual([
      versions[0], { ...versions[0], rev: 2, amount: -7, effective_at: new Date(change.committed_at) },
    ])
  })

  test('過期、新建版本條件與同內容重存', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const create = saveRule(classId)
    const initial = await commitOperation(client, create)
    for (const rev of [0, 2]) {
      expect(await submit(client, saveRule(classId, create.payload, rev))).toMatchObject({
        code: 'STALE_STATE', current: {
          rev: 1, value: initial.changes[0].value, last_op_id: create.op_id, committed_at: initial.committed_at,
        },
      })
    }
    expect(await submit(client, saveRule(classId, {}, 3))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 0, value: null, last_op_id: null },
    })
    const unchanged = await commitOperation(client, saveRule(classId, create.payload, 1))
    expect(unchanged).toMatchObject({ result: { noop: true }, changes: [{ rev: 1, prev_rev: 1 }] })
    expect(await ruleVersions(client, classId, create.payload.rule_id)).toHaveLength(1)
  })

  test('停用新增相同內容版本，持新版本可重新啟用', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const create = saveRule(classId, { kind: 'event', event: 'submission.late', amount: -3 })
    const ruleId = create.payload.rule_id
    await commitOperation(client, create)
    const retired = await commitOperation(client, retireRule(classId, ruleId, 1))
    expect(retired.changes[0]).toMatchObject({ prev_rev: 1, rev: 2, value: { disabled: true, amount: -3 } })
    const [original, disabled] = await ruleVersions(client, classId, ruleId)
    expect(disabled).toEqual({ ...original, rev: 2, effective_at: new Date(retired.committed_at) })
    expect(await submit(client, saveRule(classId, create.payload, 1))).toMatchObject({ code: 'STALE_STATE' })
    expect(await commitOperation(client, retireRule(classId, ruleId, 2))).toMatchObject({ result: { noop: true } })
    expect(await ruleVersions(client, classId, ruleId)).toHaveLength(2)
    expect(await commitOperation(client, saveRule(classId, create.payload, 2))).toMatchObject({
      result: { noop: false }, changes: [{ rev: 3, value: { disabled: false } }],
    })
  })

  test('同事件唯一，規則種類與事件不可改', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const fields = { kind: 'event', event: 'submission.missing' }
    const first = saveRule(classId, fields)
    const second = saveRule(classId, fields)
    await commitOperation(client, first)
    expect(await submit(client, second)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    for (const changed of [{ kind: 'manual', event: undefined }, { event: 'submission.late' }]) {
      expect(await submit(client, saveRule(classId, { ...first.payload, ...changed }, 1))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
    await commitOperation(client, retireRule(classId, first.payload.rule_id, 1))
    await commitOperation(client, saveRule(classId, second.payload))
    expect(await submit(client, saveRule(classId, first.payload, 2))).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  test('跨班停用查無目標，另一班資料不變', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const { classId: otherClass } = await addClass(client)
    const create = saveRule(otherClass)
    await commitOperation(client, create)
    const before = await classSnapshot(client, otherClass)
    expect(await submit(client, retireRule(classId, create.payload.rule_id, 1))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await classSnapshot(client, otherClass)).toBe(before)
  })
})
