import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { classSnapshot } from '../../db-v2/test-support/checks.js'
import { adjustment } from '../../db-v2/test-support/operations.js'
import { createTestClass, createTestSession, createTestTeacher } from './fixtures.js'
import { commitReadOperation, readEntities } from './read-entities.js'
import { readTestTime, readWriteBaseline, sendRead } from './read.js'

const marker = 'OTHER-CLASS-MARKER-7f3a'

export function testClassReadBoundaries(fixture, endpoints) {
  test.each(endpoints)('%s 區分缺權杖與過期權杖且資料庫不變', async (endpoint, makeBody) => {
    const context = fixture()
    const { client, teacher, target } = context
    const expired = await createTestSession(client, teacher.id, { expiresAt: new Date(readTestTime) })
    const before = await readWriteBaseline(client)
    const cases = [[null, 'AUTH_REQUIRED'], [expired, 'AUTH_EXPIRED']]
    for (const [token, code] of cases) {
      for (const body of [makeBody(target.classId), '{']) {
        const response = await sendRead(context, endpoint, body, { token })
        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ error: { code } })
      }
    }
    expect(await readWriteBaseline(client)).toEqual(before)
  })

  describe.each(endpoints)('%s 的班級檢查', (endpoint, makeBody) => {
    test.each([
      ['第 4 版', randomUUID],
      ['64 字元', () => randomBytes(32).toString('hex')],
    ])('%s 編號的別班與缺班同回 403，本文逐位元組相同且無寫入', async (_format, makeId) => {
      const context = fixture()
      const { client } = context
      const foreign = makeId()
      await createTestClass(client, { classId: foreign, owner: createTestTeacher() })
      const before = await readWriteBaseline(client)
      const foreignBefore = await classSnapshot(client, foreign)
      for (const classId of [foreign, makeId()]) {
        const response = await sendRead(context, endpoint, makeBody(classId))
        expect(response.statusCode).toBe(403)
        expect(response.rawPayload).toEqual(Buffer.from('{"error":{"code":"CLASS_FORBIDDEN"}}'))
      }
      expect(await classSnapshot(client, foreign)).toBe(foreignBefore)
      expect(await readWriteBaseline(client)).toEqual(before)
    })
  })
}

export async function populateReadNeighbor(client, owner) {
  const [[, , createClass], ...entities] = readEntities
  const creation = createClass()
  await commitReadOperation(client, creation, owner)
  const { student_ids: studentIds } = creation.payload
  const target = { classId: creation.class_id, studentId: studentIds[0], studentIds, defaultsRev: 1 }
  for (const [entity, , generate] of entities) {
    const op = await generate(client, target, owner)
    if (entity === 'student') op.payload.name = '測試學生 ' + marker
    if (entity === 'task') op.payload.title = '測試作業 ' + marker
    if (entity === 'rule') op.payload.name = '測試規則 ' + marker
    if (entity === 'account') op.payload.reason = '測試理由 ' + marker
    const receipt = await commitReadOperation(client, op, owner)
    expect(receipt.changes, entity).toContainEqual(expect.objectContaining({ entity }))
  }
  return target
}

export function expectNoNeighbor(response, neighbor) {
  expect(response.body).not.toContain(marker)
  expect(response.body).not.toContain(neighbor.classId)
  for (const id of neighbor.studentIds) expect(response.body).not.toContain(id)
}

export function testReadIsolation(fixture, endpoint, makeRequest, prepare = () => {}) {
  test.each([
    ['別的老師', false],
    ['同一位老師', true],
  ])(`%s 的另一班無法混入 ${endpoint} 回應`, async (_label, sameOwner) => {
    const context = fixture()
    const { client, target, teacher } = context
    await commitReadOperation(client, adjustment(target), teacher)
    const prepared = await prepare(context)
    const before = await makeRequest(context, prepared)
    expect(before.statusCode).toBe(200)
    const neighbor = await populateReadNeighbor(client, sameOwner ? teacher : createTestTeacher())
    const after = await makeRequest(context, prepared)
    expect(after.statusCode).toBe(200)
    expectNoNeighbor(after, neighbor)
    expect(after.rawPayload).toEqual(before.rawPayload)
  })
}
