import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { confirm, confirmationsFor, propose, submissionData } from './test-support/confirmations.js'
import { addClass, classSequence, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { assignTask, markSubmission } from './test-support/submission-flow.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function markRemaining(target, rev = 1) {
  const op = setStatus(target, 'on_time', { rev })
  op.payload.only_if_no_proposal = true
  return op
}

async function pendingAtRevisionFive(client) {
  const target = await assignTask(client, await addClass(client))
  for (const [index, status] of ['on_time', 'leave', 'exempt', 'pending'].entries()) {
    await markSubmission(client, target, status, index + 1)
  }
  return target
}

async function pendingProposal(client) {
  const target = await assignTask(client, await addClass(client))
  const { op_id: confirmationId } = await commitOperation(client, propose(target, 'missing'))
  return { ...target, confirmationId }
}

const cases = [
  ['submission.propose', (classId, target) => propose({ ...target, classId }, 'late')],
  ['confirmation.confirm', (classId, target) => confirm(classId, target.confirmationId)],
  ['confirmation.reject', (classId, target) => confirm(classId, target.confirmationId, 'confirmation.reject')],
]

describeDatabase('學生點收驗收', () => {
  const database = useTestDatabase()

  test('03:433 版本五有旗標保留提議，無旗標則由老師定案', async () => {
    const { client } = database()
    const target = await pendingAtRevisionFive(client)
    const proposal = await commitOperation(client, propose(target, 'missing'))
    const before = await classSnapshot(client, target.classId)
    const blocked = await submit(client, markRemaining(target, 5))
    expect(blocked).toMatchObject({
      code: 'STALE_STATE', current: { rev: 5, value: { status: 'pending' }, proposal: {
        confirmation_id: proposal.op_id, proposed_status: 'missing', status: 'pending', proposed_at: proposal.committed_at,
      } },
    })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    const fresh = await pendingAtRevisionFive(client)
    const another = await commitOperation(client, propose(fresh, 'missing'))
    const receipt = await markSubmission(client, fresh, 'on_time', 5)
    expect(receipt.changes).toMatchObject([
      { entity: 'submission', prev_rev: 5, rev: 6, value: { status: 'on_time' } },
      { entity: 'confirmation', key: { confirmation_id: another.op_id }, value: { status: 'superseded' } },
    ])
  })

  test('03:436 收回只結束提議，從未提議或已點收的收回都不改資料', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client, { students: ['enrolled', 'enrolled', 'enrolled'] }))
    const { classId, studentIds } = target
    const b = { ...target, studentId: studentIds[1] }
    const c = { ...target, studentId: studentIds[2] }
    await markSubmission(client, c, 'on_time')
    const proposal = await commitOperation(client, propose(target, 'missing'))
    const before = await submissionData(client, classId)
    const withdrawal = await commitOperation(client, propose(target, 'pending'))
    expect(withdrawal).toMatchObject({ result: { noop: false }, changes: [
      { entity: 'confirmation', key: { confirmation_id: proposal.op_id }, value: { status: 'superseded' } },
    ] })
    expect(await confirmationsFor(client, classId)).toHaveLength(1)
    expect(await submissionData(client, classId)).toEqual(before)
    await commitOperation(client, markRemaining(target))
    const snapshotOptions = { ignoreClassSequence: true }
    const snapshot = await classSnapshot(client, classId, snapshotOptions)
    let sequence = await classSequence(client, classId)
    for (const student of [b, c]) {
      const receipt = await commitOperation(client, propose(student, 'pending'))
      expect(receipt).toMatchObject({ result: { noop: true }, changes: [], class_seq: ++sequence })
      expect(await classSnapshot(client, classId, snapshotOptions)).toBe(snapshot)
      expect(await classSequence(client, classId)).toBe(sequence)
    }
  })

  test.each([false, true])('03:437 第二筆前已送出為 %s 時重播第一筆，收回後沒有待確認', async (sentSecond) => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client))
    const first = propose(target, 'missing')
    const second = propose(target, 'late')
    const withdraw = propose(target, 'pending')
    const original = await commitOperation(client, first)
    if (sentSecond) await commitOperation(client, second)
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, first)).toEqual({ ...original, replayed: true })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    if (!sentSecond) await commitOperation(client, second)
    await commitOperation(client, withdraw)
    expect(await confirmationsFor(client, target.classId)).toMatchObject([
      { confirmation_id: first.op_id, status: 'superseded', proposed_status: 'missing' },
      { confirmation_id: second.op_id, status: 'superseded', proposed_status: 'late' },
    ])
    expect(await submissionRow(client, target)).toMatchObject({ status: 'pending', rev: 1, basis_rev: 1 })
  })

  test('03:442 其餘記成準時只擋有提議的學生，乙事後提議被拒', async () => {
    const { client } = database()
    const target = await assignTask(client, await addClass(client, { students: ['enrolled', 'enrolled'] }))
    const b = { ...target, studentId: target.studentIds[1] }
    const proposal = await commitOperation(client, propose(target, 'missing'))
    const before = await classSnapshot(client, target.classId)
    expect(await submit(client, markRemaining(target))).toMatchObject({ code: 'STALE_STATE', current: {
      proposal: { confirmation_id: proposal.op_id, status: 'pending' },
    } })
    expect(await classSnapshot(client, target.classId)).toBe(before)
    await commitOperation(client, markRemaining(b))
    expect(await submit(client, propose(b, 'late'))).toMatchObject({ code: 'INVALID_TRANSITION' })
    expect(await submissionRow(client, b)).toMatchObject({ status: 'on_time', rev: 2 })
    expect(await confirmationsFor(client, target.classId)).toMatchObject([{ confirmation_id: proposal.op_id, status: 'pending' }])
  })

  test.each(cases)('%s 禁帶 expect，包括 JSON null', async (_type, make) => {
    const { client } = database()
    const target = await pendingProposal(client)
    for (const expectVersion of [{ rev: 1 }, null]) {
      expect(await submit(client, { ...make(target.classId, target), expect: expectVersion }))
        .toMatchObject({ code: 'INVALID_PAYLOAD', status: 'rejected' })
    }
  })

  test.each(cases)('%s 拒絕小野、封存班、多餘鍵與跨班目標', async (_type, make) => {
    const { client } = database()
    const local = await pendingProposal(client)
    const other = await pendingProposal(client)
    await authorizeAgent(client, local.classId)
    const denied = await agentSubmit(client, local.classId, [make(local.classId, local)])
    expect(denied.receipts).toMatchObject([{ code: 'FORBIDDEN_ROLE' }])
    const extra = make(local.classId, local)
    extra.payload.unrecognized = true
    expect(await submit(client, extra)).toMatchObject({ code: 'INVALID_PAYLOAD' })
    const before = await classSnapshot(client, other.classId)
    const cross = await submit(client, make(local.classId, other))
    expect(cross).toMatchObject({ code: 'NOT_FOUND' })
    expect(cross).not.toHaveProperty('current')
    expect(await classSnapshot(client, other.classId)).toBe(before)
    expect(await confirmationsFor(client, other.classId)).toMatchObject([
      { confirmation_id: other.confirmationId, status: 'pending' },
    ])
    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [local.classId])
    expect(await submit(client, make(local.classId, local))).toMatchObject({ code: 'CLASS_ARCHIVED' })
  })
})
