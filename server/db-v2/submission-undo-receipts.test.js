import { expect, test } from 'vitest'
import { confirm, propose } from './test-support/confirmations.js'
import { addClass } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, markSubmission, saveEventRule } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const daily = 'daily_quest.complete'
const missing = 'submission.missing'

async function assertUndoFields(client, receipt, { added, reversed, entities }) {
  expect(receipt.changes.map(({ entity }) => entity)).toEqual(entities)
  for (const change of receipt.changes) {
    expect(change).toMatchObject({
      entity: expect.any(String), key: expect.any(Object), prev_rev: expect.any(Number), rev: expect.any(Number),
      last_op_id: receipt.op_id,
    })
    expect(change).toHaveProperty('prev_value')
    expect(change).toHaveProperty('value')
    if (change.entity === 'submission') {
      expect(change).toMatchObject({ prev_basis_rev: expect.any(Number), basis_rev: expect.any(Number) })
    }
  }

  const effectIdentity = {
    effect_id: expect.any(String), lineage_id: expect.any(String),
    subject_kind: expect.any(String), subject_key: expect.any(String), root_transaction_id: expect.any(String),
  }
  expect(receipt.result.effects_added).toMatchObject(
    added.map((event) => ({ ...effectIdentity, event, amount: expect.any(Number) })),
  )
  expect(receipt.result.effects_reversed).toMatchObject(reversed.map((event) => ({
    ...effectIdentity, event, rule_id: expect.any(String), rule_rev: expect.any(Number),
    effective_amount: expect.any(Number), effective_at: expect.any(String),
  })))
  const { rows } = await client.query(`
    SELECT transaction_id FROM ppt.transactions WHERE op_id = $1
    ORDER BY array_position($2::text[], transaction_id)
  `, [receipt.op_id, receipt.result.transactions])
  expect(receipt.result.transactions).toEqual(rows.map(({ transaction_id }) => transaction_id))
}

async function eventFixture(client) {
  const target = await assignTask(client, await addClass(client))
  await saveEventRule(client, target.classId, daily, 7)
  await saveEventRule(client, target.classId, missing, -5)
  return target
}

describeDatabase('提供撤銷使用的繳交收據', () => {
  const database = useTestDatabase()

  test('確認提議收據含繳交基準、待確認項目及兩類效果', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    await markSubmission(client, target, 'on_time')
    const second = await assignTask(client, target)
    const proposal = await commitOperation(client, propose(second, 'missing'))
    const receipt = await commitOperation(client, confirm(target.classId, proposal.op_id))
    await assertUndoFields(client, receipt, {
      added: [missing], reversed: [daily], entities: ['submission', 'account', 'confirmation'],
    })
  })

  test('每日任務的新增與沖回在各自效果清單可用事件識別', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    const first = await markSubmission(client, target, 'on_time')
    const second = await markSubmission(client, target, 'missing', 2)
    await assertUndoFields(client, first, { added: [daily], reversed: [], entities: ['submission', 'account'] })
    await assertUndoFields(client, second, { added: [missing], reversed: [daily], entities: ['submission', 'account'] })
    expect(second.result.effects_reversed[0]).toMatchObject({
      root_transaction_id: first.result.transactions[0], effective_amount: 7, effective_at: first.committed_at,
    })
  })

  test('OP-14 順帶取代提議可由 entity 識別，保留其繳交與扣分資料', async () => {
    const { client } = database()
    const target = await eventFixture(client)
    const proposal = await commitOperation(client, propose(target, 'late'))
    const receipt = await markSubmission(client, target, 'missing')
    await assertUndoFields(client, receipt, {
      added: [missing], reversed: [], entities: ['submission', 'account', 'confirmation'],
    })
    expect(receipt.changes.find(({ entity }) => entity === 'confirmation')).toMatchObject({
      key: { confirmation_id: proposal.op_id }, prev_value: { status: 'pending' }, value: { status: 'superseded' },
    })
  })
})
