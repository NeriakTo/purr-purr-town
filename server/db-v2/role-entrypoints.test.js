import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { addClass, adjustment, submit } from './test-support/operations.js'
import { agentSubmitAs, connectAsRole } from './test-support/roles.js'
import { addSubmission, addTask, setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function submitAndRollBack(client, action) {
  await client.query('BEGIN')
  try {
    return await action()
  } finally {
    await client.query('ROLLBACK')
  }
}

function comparableReceipt(receipt) {
  const { committed_at: committedAt, result, ...fields } = receipt
  expect(committedAt).toEqual(expect.any(String))
  const transactions = result.transactions.map((transactionId) => {
    expect(transactionId).toEqual(expect.any(String))
    return '<交易編號>'
  })
  return { ...fields, result: { ...result, transactions } }
}

describeDatabase('以連線角色提交操作', () => {
  const database = useTestDatabase()

  it('網站以老師身分提交 OP-24，收據與管理連線相同', async () => {
    const { client } = database()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const baseline = await submitAndRollBack(client, () => submit(client, op))
    const web = await connectAsRole(database(), 'ppt_web')
    try {
      const receipt = await submit(web, op)
      expect(receipt).toMatchObject({ status: 'committed', code: 'OK', replayed: false, op_id: op.op_id })
      expect(comparableReceipt(receipt)).toEqual(comparableReceipt(baseline))
      const { rows: [{ balance }] } = await client.query(
        'SELECT balance FROM ppt.accounts WHERE class_id = $1 AND student_id = $2',
        [fixture.classId, fixture.studentId],
      )
      expect(balance).toBe(String(op.payload.amount))
    } finally {
      await web.end()
    }
  })

  it('小野經包裝入口提交 OP-14，收據與管理連線相同', async () => {
    const { client } = database()
    const fixture = await addClass(client)
    await authorizeAgent(client, fixture.classId)
    const target = { ...fixture, taskId: await addTask(client, fixture.classId) }
    await addSubmission(client, target)
    const ops = [setStatus(target, 'on_time')]
    const callId = randomUUID()
    const note = '通路測試記號'
    const baseline = await submitAndRollBack(client, () => agentSubmit(client, fixture.classId, ops, callId, note))
    const agent = await connectAsRole(database(), 'ppt_agent')
    try {
      const { receipts, ...batch } = await agentSubmitAs(agent, fixture.classId, ops, callId, note)
      const { receipts: baselineReceipts, ...baselineBatch } = baseline
      expect(batch).toEqual(baselineBatch)
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({ status: 'committed', code: 'OK', replayed: false, op_id: ops[0].op_id })
      expect(receipts.map(comparableReceipt)).toEqual(baselineReceipts.map(comparableReceipt))
      expect(await submissionRow(client, target)).toMatchObject({ status: 'on_time', last_op_id: ops[0].op_id })
      const { rows: [call] } = await client.query('SELECT note FROM ppt.agent_calls WHERE call_id = $1', [callId])
      expect(call).toEqual({ note })
    } finally {
      await agent.end()
    }
  })
})
