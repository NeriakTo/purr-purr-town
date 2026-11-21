import { expect, test } from 'vitest'
import { addClass, adjustment, operationCount, submit } from './test-support/operations.js'
import { saveProduct } from './test-support/products.js'
import { commitOperation } from './test-support/schoolwork.js'
import { currency, setSetting } from './test-support/settings.js'
import { purchase } from './test-support/shop.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const limits = {
  max_students_per_call: 5, max_students_per_10min: 10, max_points_per_tx: 200,
  max_points_per_student_per_day: 300, max_pending_held: 5,
}

async function transactionRows(client, classId) {
  const { rows } = await client.query('SELECT * FROM ppt.transactions WHERE class_id = $1 ORDER BY transaction_id', [classId])
  return rows
}

describeDatabase('OP-43 設定鍵', () => {
  const db = useTestDatabase()

  test.each([
    ['currency', currency(), currency(8)],
    ['agentLimits', limits, { ...limits, max_students_per_call: 1 }],
    ['correctionOverdueGraceDays', 0, 365],
    ['currentSemester', null, '115-2'],
    ['taskTypes', ['作業'], ['作業', '考試']],
    ['ruleCategories', [{ name: '測試' }], []],
    ['semesterPeriods', { '115-1': { start: null, end: '2028-02-29' } }, { '115-2': { start: '2028-03-01' } }],
    ['shopMeta', {}, { title: '測試商店' }],
  ])('%s 可建立、更新、同值成立且回版本衝突現值', async (key, first, latest) => {
    const { client } = db()
    const { classId } = await addClass(client)
    const created = await commitOperation(client, setSetting(classId, key, first))
    expect(created.changes).toEqual([{
      entity: 'setting', key: { key }, prev_rev: 0, rev: 1, last_op_id: created.op_id,
      prev_value: null, value: { value: first },
    }])
    const updated = await commitOperation(client, setSetting(classId, key, latest, { rev: 1 }))
    expect(updated.changes[0]).toMatchObject({ prev_rev: 1, rev: 2, prev_value: { value: first }, value: { value: latest } })
    const noop = await commitOperation(client, setSetting(classId, key, latest, { after_op: updated.op_id }))
    expect(noop).toMatchObject({ result: { noop: true }, changes: [{ rev: 2, last_op_id: updated.op_id }] })
    expect(await submit(client, setSetting(classId, key, first, { rev: 1 })))
      .toMatchObject({ code: 'STALE_STATE', current: { rev: 2, value: { value: latest } } })
  })

  test('拒絕未知鍵、缺少 value 與多餘 payload 鍵', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    const extra = setSetting(classId, 'shopMeta', {})
    extra.payload.other = true
    for (const op of [setSetting(classId, 'unknown', {}), setSetting(classId, 'shopMeta', undefined), extra]) {
      expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })

  test.each([
    ['currency', [{ base: {}, tier1: { rate: 1 } }, currency(0), currency('7'), currency(1e30)]],
    ['agentLimits', [{ ...limits, max_pending_held: undefined }, { ...limits, extra: 1 },
      { ...limits, max_points_per_tx: 0 }, { ...limits, max_points_per_tx: 1e30 }]],
    ['correctionOverdueGraceDays', [-1, 1.5, '1', 366]],
    ['currentSemester', ['115-3']],
    ['taskTypes', [['作業', '作業'], [''], 5]],
    ['ruleCategories', [['錯誤種類']]],
    ['semesterPeriods', [{ '115-1': [] }, { '115-1': { start: '2026-02-30' } }]],
    ['shopMeta', [[]]],
  ])('%s 拒絕不合法的值', async (key, values) => {
    const { client } = db()
    const { classId } = await addClass(client)
    for (const value of values) {
      expect(await submit(client, setSetting(classId, key, value))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })

  test('值日職務設成空值會成立並留下操作紀錄', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    const count = await operationCount(client)
    const receipt = await commitOperation(client, setSetting(classId, 'dutyJobId', null))
    expect(receipt.changes).toEqual([{
      entity: 'setting', key: { key: 'dutyJobId' }, prev_rev: 0, rev: 1,
      last_op_id: receipt.op_id, prev_value: null, value: { value: null },
    }])
    expect(await operationCount(client)).toBe(count + 1)
  })

  test('舊字串匯率仍可購買並更新，換匯只影響後續交易', async () => {
    const { client } = db()
    const target = await addClass(client)
    await client.query("INSERT INTO ppt.settings_entries (class_id, key, value) VALUES ($1, 'currency', $2)",
      [target.classId, currency('100', '1000')])
    const product = saveProduct(target.classId, { price_unit: 'fish' })
    await commitOperation(client, product)
    await commitOperation(client, adjustment(target, 1000))
    const purchaseTarget = { ...target, productId: product.payload.product_id }
    await commitOperation(client, purchase(purchaseTarget, 300))
    const history = await transactionRows(client, target.classId)
    await commitOperation(client, setSetting(target.classId, 'currency', currency(), { rev: 1 }))
    expect(await transactionRows(client, target.classId)).toEqual(history)
    expect(await submit(client, purchase(purchaseTarget, 300))).toMatchObject({ code: 'PRICE_CHANGED' })
    expect((await commitOperation(client, purchase(purchaseTarget, 21))).changes[2].value.balance).toBe(679)
    await commitOperation(client, setSetting(target.classId, 'taskTypes', ['作業']))
    const { rows } = await client.query('SELECT key, rev FROM ppt.settings_entries WHERE class_id = $1 ORDER BY key',
      [target.classId])
    expect(rows).toEqual([{ key: 'currency', rev: 2 }, { key: 'taskTypes', rev: 1 }])
  })
})
