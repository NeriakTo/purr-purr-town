import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation, createTask, restoreTask, retireRule, saveRule, updateTask, voidTask } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function existingTargets(client) {
  const { classId, studentId } = await addClass(client)
  const task = createTask(classId)
  const rule = saveRule(classId)
  await commitOperation(client, task)
  await commitOperation(client, rule)
  return { classId, studentId, taskId: task.payload.task_id, rule }
}

const cases = [
  {
    type: 'task.create', expectMode: 'forbidden',
    make: ({ classId }, other) => createTask(classId, { assignee_ids: [other.studentId] }),
  },
  {
    type: 'task.update', expectMode: 'required',
    make: ({ classId }, target) => updateTask(classId, target.taskId, { title: '測試改名' }),
  },
  {
    type: 'task.void', expectMode: 'required',
    make: ({ classId }, target) => voidTask(classId, target.taskId, true),
  },
  {
    type: 'task.restore', expectMode: 'required',
    make: ({ classId }, target) => restoreTask(classId, target.taskId),
  },
  {
    type: 'rule.save', expectMode: 'required',
    make: ({ classId }, target) => saveRule(classId, target.rule.payload),
  },
  {
    type: 'rule.retire', expectMode: 'required',
    make: ({ classId }, target) => retireRule(classId, target.rule.payload.rule_id, 1),
  },
]

function invalidVersions(mode) {
  if (mode === 'forbidden') return [{ rev: 1 }, null]
  return [undefined, null, [], 1, {}, { rev: 1, after_op: '其他操作' }]
}

describeDatabase('作業與規則的共通拒絕', () => {
  const database = useTestDatabase()

  test.each(cases)('$type 僅接受規定的 expect', async ({ expectMode, make }) => {
    const { client } = database()
    const target = await existingTargets(client)
    for (const expectVersion of invalidVersions(expectMode)) {
      const op = { ...make(target, target), expect: expectVersion }
      expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD', status: 'rejected' })
    }
  })

  test('省略 expect 建作業後，同編號帶 JSON null 重播原收據', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = createTask(classId)
    const original = await commitOperation(client, op)
    const before = await classSnapshot(client, classId)
    expect(await submit(client, { ...op, expect: null })).toEqual({ ...original, replayed: true })
    expect(await classSnapshot(client, classId)).toBe(before)
  })

  test.each(cases)('$type 小野、封存班、多餘鍵與跨班目標', async ({ type, make }) => {
    const { client } = database()
    const local = await existingTargets(client)
    const other = await existingTargets(client)
    await authorizeAgent(client, local.classId)
    const agent = await agentSubmit(client, local.classId, [make(local, local)])
    expect(agent.receipts).toMatchObject([{ status: 'rejected', code: 'FORBIDDEN_ROLE' }])

    const extra = make(local, local)
    extra.payload.unrecognized = true
    expect(await submit(client, extra)).toMatchObject({ code: 'INVALID_PAYLOAD' })

    const otherBefore = await classSnapshot(client, other.classId)
    const cross = make(local, other)
    if (type === 'rule.save') {
      expect(await commitOperation(client, cross)).toMatchObject({
        changes: [{ key: { rule_id: other.rule.payload.rule_id }, prev_rev: 0, rev: 1 }],
      })
    } else {
      expect(await submit(client, cross)).toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await classSnapshot(client, other.classId)).toBe(otherBefore)

    await client.query("UPDATE ppt.classes SET status = 'archived' WHERE class_id = $1", [local.classId])
    expect(await submit(client, make(local, local))).toMatchObject({ code: 'CLASS_ARCHIVED' })
  })

  test('作廢須明確帶布林沖回選項', async () => {
    const { client } = database()
    const { classId, taskId } = await existingTargets(client)
    for (const reverseEffects of [undefined, null, 'false', 0]) {
      expect(await submit(client, voidTask(classId, taskId, reverseEffects))).toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })
})
