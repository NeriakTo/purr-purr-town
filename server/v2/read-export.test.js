import { describe, expect, test } from 'vitest'
import { addImportedDeduction, addImportedEffect, addImportedSubmission, addImportedTask } from '../db-v2/test-support/legacy-effects.js'
import { adjustment, classSequence } from '../db-v2/test-support/operations.js'
import { assignJob, runPayroll, saveJob } from '../db-v2/test-support/payroll.js'
import { saveRule } from '../db-v2/test-support/schoolwork.js'
import { createTestSession } from './test-support/fixtures.js'
import { testClassReadBoundaries, testReadIsolation } from './test-support/read-boundaries.js'
import { commitReadOperation } from './test-support/read-entities.js'
import { readJson } from './test-support/read-json.js'
import { readTestTime, readWriteBaseline, sendRead, useReadFixtures } from './test-support/read.js'
import { insertReadTransactions, measureReadRequest, prepareReadScale } from './test-support/read-transactions.js'

async function addAllEffectStatuses(context) {
  const { client, target, teacher } = context
  const effectIds = []
  for (const status of ['legacy_unresolved', 'active', 'reversed', 'dismissed']) {
    const task = { ...target, taskId: await addImportedTask(client, target.classId) }
    await addImportedSubmission(client, task, 'missing')
    const fields = status === 'active' || status === 'reversed'
      ? { status, event: 'submission.missing', root: await addImportedDeduction(client, target) } : { status }
    effectIds.push(await addImportedEffect(client, task, fields))
  }
  const op = saveJob(target.classId)
  const jobId = op.payload.job_id
  await commitReadOperation(client, op, teacher)
  await commitReadOperation(client, assignJob(target.classId, jobId, [target.studentId]), teacher)
  await commitReadOperation(client, runPayroll(target.classId, [jobId]), teacher)
  return effectIds
}

async function lastExportAt(context) {
  const response = await sendRead(context, 'classes')
  expect(response.statusCode).toBe(200)
  return response.json().classes.find(row => row.class_id === context.target.classId).last_export_at
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('整班備份與最後匯出時間', () => {
  const fixture = useReadFixtures()
  testClassReadBoundaries(fixture, [['export', class_id => ({ class_id })]])
  testReadIsolation(fixture, 'export', context => sendRead(context, 'export', { class_id: context.target.classId }),
    async context => {
      const { client, target, teacher } = context
      await commitReadOperation(client, saveRule(target.classId), teacher)
      await addAllEffectStatuses(context)
    },
    (context, target, teacher) => addAllEffectStatuses({ ...context, target, teacher }),
  )

  test('匯出 v1 帶整班版本、未分頁交易、各種效果及舊規則版本', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    await insertReadTransactions(client, target, 4)
    const effectIds = await addAllEffectStatuses(context)
    const rule = saveRule(target.classId)
    await commitReadOperation(client, rule, teacher)
    await commitReadOperation(client, saveRule(target.classId, { ...rule.payload, name: '測試新版規則' }, 1), teacher)
    const app = context.makeApp({ config: { read: { pageSize: 1 } } })
    const state = await readJson(context, 'state', {}, { app })
    const result = await readJson(context, 'export', {}, { app })
    expect(Object.keys(result).sort()).toEqual([
      'class_id', 'class_seq', 'effects', 'export_v', 'exported_at', 'rows', 'rule_versions', 'server_time', 'transactions',
    ])
    expect(result).toMatchObject({
      export_v: 1, class_id: target.classId, class_seq: await classSequence(client, target.classId),
      rows: state.rows, server_time: readTestTime, exported_at: readTestTime,
    })
    const { rows: [{ count }] } = await client.query('SELECT count(*)::int FROM ppt.transactions WHERE class_id = $1', [target.classId])
    expect(count).toBeGreaterThan(1)
    expect(result.transactions).toHaveLength(count)
    expect(result.transactions[0]).toEqual(state.transactions.items[0])
    const { rows: effects } = await client.query(`
      SELECT to_jsonb(effect) AS item FROM ppt.effects AS effect
      WHERE class_id = $1 ORDER BY effect_id COLLATE "C"
    `, [target.classId])
    expect(result.effects.map(row => row.effect_id).sort()).toEqual(effects.map(row => row.item.effect_id).sort())
    expect(result.effects.filter(row => effectIds.includes(row.effect_id)).map(row => row.status).sort()).toEqual([
      'active', 'dismissed', 'legacy_unresolved', 'reversed',
    ])
    expect(result.effects).toContainEqual(expect.objectContaining({ origin: 'op' }))
    expect(result.rule_versions.filter(row => row.rule_id === rule.payload.rule_id).map(row => [row.rev, row.name])).toEqual([
      [1, rule.payload.name], [2, '測試新版規則'],
    ])
  })

  test('第二個裝置讀到匯出時間，重新匯出會更新且不產生操作或序號', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    const token = await createTestSession(client, teacher.id, { expiresAt: new Date('2027-02-01') })
    const device = { ...context, token }
    const before = await readWriteBaseline(client)
    expect(await lastExportAt(device)).toBeNull()
    const first = await readJson(context, 'export')
    expect(await lastExportAt(device)).toBe(first.exported_at)
    expect(first.class_seq).toBe(Number(before.sequences[target.classId]))
    const secondTime = '2026-11-22T09:00:00.001Z'
    const app = context.makeApp({ clock: () => new Date(secondTime) })
    const second = await readJson(context, 'export', {}, { app })
    expect(second.exported_at).toBe(secondTime)
    expect(await lastExportAt(device)).toBe(second.exported_at)
    const after = await readWriteBaseline(client)
    expect(after).toEqual({ ...before, exports: after.exports })
    expect(Object.keys(after.exports).filter(id => id === target.classId)).toEqual([target.classId])
  })

  test('記錄最後匯出時間失敗時只回錯誤，保留舊匯出時間', async () => {
    const context = fixture()
    const { client, target } = context
    await client.query('INSERT INTO ppt_web_state.class_exports VALUES ($1, $2)', [target.classId, '2026-11-20T08:00:00Z'])
    const before = await readWriteBaseline(client)
    let called = false
    const app = context.makeApp({ hooks: {
      beforeExportRecord() {
        called = true
        throw new Error('測試寫入失敗')
      },
    } })
    const response = await sendRead(context, 'export', { class_id: target.classId }, { app })
    expect(called).toBe(true)
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } })
    expect(await readWriteBaseline(client)).toEqual(before)
  })

  test('匯出讀序號後有人提交，備份序號、帳戶與交易都維持先前快照', async () => {
    const context = fixture()
    const { client, target, teacher } = context
    await commitReadOperation(client, adjustment(target, 11), teacher)
    const before = await readJson(context, 'state')
    const newer = adjustment(target, 13)
    const app = context.makeApp({ hooks: {
      async duringRead() {
        await commitReadOperation(client, newer, teacher)
      },
    } })
    const result = await readJson(context, 'export', {}, { app })
    expect(result).toMatchObject({
      class_seq: before.class_seq,
      rows: before.rows,
      transactions: before.transactions.items,
    })
    expect(result.transactions.some(row => row.op_id === newer.op_id)).toBe(false)
    expect(await classSequence(client, target.classId)).toBe(before.class_seq + 1)
  })

  test('較早的匯出晚到也保留較新的最後匯出時間', async () => {
    const context = fixture()
    const { resolve: announce, promise: waiting } = Promise.withResolvers()
    const { resolve: release, promise: allowWrite } = Promise.withResolvers()
    const old = context.makeApp({ hooks: {
      async beforeExportRecord() {
        announce()
        await allowWrite
      },
    } })
    const newerTime = '2026-11-22T09:00:00.000Z'
    const newer = context.makeApp({ clock: () => new Date(newerTime) })
    const priorRequest = sendRead(context, 'export', { class_id: context.target.classId }, { app: old })
    try {
      await Promise.race([waiting, priorRequest.then(() => { throw new Error('匯出未等候寫入鉤子') })])
      expect((await readJson(context, 'export', {}, { app: newer })).exported_at).toBe(newerTime)
    } finally {
      release()
    }
    const prior = await priorRequest
    expect(prior.statusCode).toBe(200)
    expect(prior.json().exported_at).toBe(readTestTime)
    expect(await lastExportAt(context)).toBe(newerTime)
  })

  test('30 位學生與 1,200 筆交易的匯出量測包含全部交易', async () => {
    const context = fixture()
    const target = await prepareReadScale(context)
    const response = await measureReadRequest('整班匯出', () => sendRead(context, 'export', { class_id: target.classId }))
    expect(response.statusCode).toBe(200)
    expect(response.json().transactions).toHaveLength(1200)
    expect(response.json().rows.filter(row => row.entity === 'student')).toHaveLength(30)
  })
})
