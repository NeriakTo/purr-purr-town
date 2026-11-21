import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { saveRule } from '../db-v2/test-support/schoolwork.js'
import { createTestTeacher } from './test-support/fixtures.js'
import { commitReadOperation, readEntities } from './test-support/read-entities.js'
import { sendRead, useReadFixtures } from './test-support/read.js'

const marker = 'OTHER-CLASS-MARKER-7f3a'
const endpointCases = [
  { endpoint: 'classes', payload: () => undefined, checksSameOwner: false },
  { endpoint: 'state', payload: ({ target }) => ({ class_id: target.classId }), checksSameOwner: true },
]

function markOperation(entity, operation, ruleId) {
  switch (entity) {
    case 'student':
      operation.payload.name = '測試學生 ' + marker
      break
    case 'task':
      operation.payload.title = '測試作業 ' + marker
      break
    case 'rule':
      operation.payload.rule_id = ruleId
      operation.payload.name = '測試規則 ' + marker
      break
    case 'account':
      operation.payload.reason = '測試理由 ' + marker
      break
  }
}

async function populateOtherClass(client, owner, ruleId) {
  const [[, , createClass], ...entities] = readEntities
  const creation = createClass()
  const { changes } = await commitReadOperation(client, creation, owner)
  expect(changes).toContainEqual(expect.objectContaining({ entity: 'class' }))
  const { student_ids: studentIds } = creation.payload
  const target = { classId: creation.class_id, studentId: studentIds[0], studentIds, defaultsRev: 1 }

  for (const [entity, , generate] of entities) {
    const operation = await generate(client, target, owner)
    markOperation(entity, operation, ruleId)
    const receipt = await commitReadOperation(client, operation, owner)
    expect(receipt.changes, entity).toContainEqual(expect.objectContaining({ entity }))
  }
  const { rowCount } = await client.query(
    "SELECT 1 FROM ppt.transactions WHERE class_id = $1 AND reason = $2", [target.classId, '測試理由 ' + marker],
  )
  expect(rowCount).toBe(1)
  await client.query(
    'INSERT INTO ppt_web_state.class_exports (class_id, last_export_at) VALUES ($1, $2)',
    [target.classId, '2026-11-19T18:00:00Z'],
  )
  return target
}

async function readBody(context, { endpoint, payload }) {
  const response = await sendRead(context, endpoint, payload(context))
  expect(response.statusCode, endpoint).toBe(200)
  return response.body
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('讀取的班級隔離', () => {
  const fixture = useReadFixtures()

  test.each([
    ['別的老師', false],
    ['同一位老師', true],
  ])('%s 的另一班無法混入讀取回應', async (_owner, sameOwner) => {
    const context = fixture()
    const { client, teacher, target } = context
    const endpoints = endpointCases.filter(entry => !sameOwner || entry.checksSameOwner)
    // 兩個班的規則編號及版本相同，藉此檢查接規則版本時也比對班級。
    const ruleId = randomUUID()
    await commitReadOperation(client, saveRule(target.classId, { rule_id: ruleId }), teacher)
    const before = new Map()
    for (const entry of endpoints) before.set(entry.endpoint, await readBody(context, entry))

    const otherOwner = sameOwner ? teacher : createTestTeacher()
    const other = await populateOtherClass(client, otherOwner, ruleId)
    for (const entry of endpoints) {
      const body = await readBody(context, entry)
      expect(body, entry.endpoint).not.toContain(marker)
      expect(body, entry.endpoint).not.toContain(other.classId)
      for (const studentId of other.studentIds) expect(body, entry.endpoint).not.toContain(studentId)
      // 無文字記號的版本列也不得多出、遭替換或改變順序。
      expect(body, entry.endpoint).toBe(before.get(entry.endpoint))
    }
  })
})
