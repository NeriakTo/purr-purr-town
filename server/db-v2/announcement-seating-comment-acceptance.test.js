import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { removeAnnouncement, saveAnnouncement, saveSeating } from './test-support/announcement-seating.js'
import { classSnapshot } from './test-support/checks.js'
import { setClassStatus } from './test-support/class-student-group.js'
import { applyComment, lockComment, requestComment, saveComment, system } from './test-support/comments.js'
import { addClass, operationCount, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const operations = [
  ['OP-40', (_client, { classId }) => saveAnnouncement(classId)],
  ['OP-41', async (client, { classId }) => {
    const original = saveAnnouncement(classId)
    await commitOperation(client, original)
    return removeAnnouncement(classId, original.payload.announcement_id)
  }],
  ['OP-42', (_client, { classId, studentId }) => saveSeating(classId, { seats: { '1,1': studentId } })],
  ['OP-44', (_client, target) => saveComment(target)],
  ['OP-45', (_client, target) => lockComment(target)],
  ['OP-46', (_client, target) => requestComment(target)],
  ['OP-47', async (client, target) => {
    const request = requestComment(target)
    await commitOperation(client, request)
    return applyComment(target, request.op_id)
  }, system],
]

async function assertSavedRejection(client, op, code, send) {
  const before = await classSnapshot(client, op.class_id)
  const count = await operationCount(client)
  const receipt = await send()
  expect(receipt).toMatchObject({
    op_id: op.op_id, status: 'rejected', code, class_seq: null, replayed: false,
  })
  const { rows } = await client.query(
    'SELECT status, code, receipt FROM ppt.operations WHERE class_id = $1 AND op_id = $2',
    [op.class_id, op.op_id],
  )
  expect(rows).toEqual([{ status: 'rejected', code, receipt }])
  expect(await operationCount(client)).toBe(count + 1)
  expect(await classSnapshot(client, op.class_id)).toBe(before)
  return receipt
}

describeDatabase('公告、座位與評語的資料庫驗收', () => {
  const database = useTestDatabase()

  it.each(operations)('%s 拒絕小野、封存班與多餘鍵，每次只保存拒絕收據', async (_id, makeOperation, actor) => {
    const { client } = database()
    const target = await addClass(client)
    await authorizeAgent(client, target.classId)
    const op = await makeOperation(client, target)
    const asAgent = { ...op, op_id: randomUUID() }
    await assertSavedRejection(client, asAgent, 'FORBIDDEN_ROLE', async () => {
      const { receipts } = await agentSubmit(client, target.classId, [asAgent])
      return receipts[0]
    })

    const extra = { ...op, payload: { ...op.payload, extra: true } }
    await assertSavedRejection(client, extra, 'INVALID_PAYLOAD', () => submit(client, extra, actor))

    const archivedTarget = await addClass(client)
    const archivedOp = await makeOperation(client, archivedTarget)
    await commitOperation(client, setClassStatus(archivedTarget.classId, 'archived'))
    await assertSavedRejection(client, archivedOp, 'CLASS_ARCHIVED', () => submit(client, archivedOp, actor))
  })

  it('OP-47 帶 expect 時只保存 INVALID_PAYLOAD', async () => {
    const { client } = database()
    const target = await addClass(client)
    const request = requestComment(target)
    await commitOperation(client, request)
    const op = { ...applyComment(target, request.op_id), expect: { rev: 1 } }
    await assertSavedRejection(client, op, 'INVALID_PAYLOAD', () => submit(client, op, system))
  })

  it.each([
    ['OP-41', async (client, { classId }, foreign) => {
      const original = saveAnnouncement(foreign.classId)
      await commitOperation(client, original)
      return removeAnnouncement(classId, original.payload.announcement_id)
    }],
    ['OP-42', (_client, { classId }, { studentId }) => saveSeating(classId, { seats: { '1,1': studentId } })],
    ['OP-44', (_client, target, { studentId }) => saveComment({ ...target, studentId })],
    ['OP-45', (_client, target, { studentId }) => lockComment({ ...target, studentId })],
    ['OP-46', (_client, target, { studentId }) => requestComment({ ...target, studentId })],
  ])('%s 查不到另一班的目標且沒有現值，兩班資料不變', async (_id, makeOperation) => {
    const { client } = database()
    const target = await addClass(client)
    const foreign = await addClass(client)
    const op = await makeOperation(client, target, foreign)
    const snapshot = await classSnapshot(client, foreign.classId)
    const receipt = await assertSavedRejection(client, op, 'NOT_FOUND', () => submit(client, op))
    expect(receipt).not.toHaveProperty('current')
    expect(await classSnapshot(client, foreign.classId)).toBe(snapshot)
  })

  it('OP-40 的相同公告編號可在另一班新建，原班資料不變', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const foreign = await addClass(client)
    const original = saveAnnouncement(foreign.classId)
    await commitOperation(client, original)
    const snapshot = await classSnapshot(client, foreign.classId)
    const op = saveAnnouncement(classId, { announcement_id: original.payload.announcement_id })
    const receipt = await commitOperation(client, op)
    expect(receipt.changes[0]).toMatchObject({ prev_rev: 0, rev: 1 })
    expect(await classSnapshot(client, foreign.classId)).toBe(snapshot)
  })
})
