import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { addClass, submit } from './test-support/operations.js'
import { addImportedJob, retireJob, saveJob } from './test-support/payroll.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setSetting } from './test-support/settings.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function setDutyJob(classId, jobId, version) {
  return setSetting(classId, 'dutyJobId', jobId, version)
}

async function readDutySetting(client, classId) {
  const { rows: [setting] } = await client.query(
    "SELECT rev, value, last_op_id FROM ppt.settings_entries WHERE class_id = $1 AND key = 'dutyJobId'", [classId],
  )
  return setting
}

async function createJob(client, classId) {
  const op = saveJob(classId)
  await commitOperation(client, op)
  return op
}

describeDatabase('值日職務設定', () => {
  const database = useTestDatabase()

  it('接受本班一般及匯入職務，沿用設定版本、同值及清空', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const jobId = (await createJob(client, classId)).payload.job_id
    const imported = await addImportedJob(client, classId)
    const initial = await commitOperation(client, setDutyJob(classId, jobId))
    expect(initial.changes).toEqual([{
      entity: 'setting', key: { key: 'dutyJobId' }, value: { value: jobId }, prev_value: null,
      prev_rev: 0, rev: 1, last_op_id: initial.op_id,
    }])
    const changed = await commitOperation(client, setDutyJob(classId, imported, { rev: 1 }))
    expect(changed.changes).toMatchObject([{ rev: 2, prev_value: { value: jobId }, value: { value: imported } }])
    const repeated = await commitOperation(client, setDutyJob(classId, imported, { rev: 2 }))
    expect(repeated).toMatchObject({ result: { noop: true }, changes: [{ rev: 2 }] })
    expect(await submit(client, setDutyJob(classId, jobId, { rev: 1 }))).toMatchObject({ code: 'STALE_STATE' })
    const cleared = await commitOperation(client, setDutyJob(classId, null, { rev: 2 }))
    expect(cleared.changes).toMatchObject([{ rev: 3, prev_value: { value: imported }, value: { value: null } }])
  })

  it.each([
    ['數字', 'INVALID_PAYLOAD', () => 3], ['空字串', 'INVALID_PAYLOAD', () => ''],
    ['物件', 'INVALID_PAYLOAD', () => ({})], ['不存在兼版本不符', 'NOT_FOUND', () => randomUUID()],
    ['別班職務', 'NOT_FOUND', async (client) => {
      const other = await addClass(client)
      return (await createJob(client, other.classId)).payload.job_id
    }],
    ['停用職務', 'ENTITY_INACTIVE', async (client, classId) => {
      const id = (await createJob(client, classId)).payload.job_id
      await commitOperation(client, retireJob(classId, id))
      return id
    }],
  ])('拒絕%s且資料原狀', async (_label, code, makeValue) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const value = await makeValue(client, classId)
    const before = await classSnapshot(client, classId)
    const receipt = await submit(client, setDutyJob(classId, value, { rev: 99 }))
    expect(receipt).toMatchObject({ status: 'rejected', code })
    expect(receipt).not.toHaveProperty('current')
    expect(await classSnapshot(client, classId)).toBe(before)
  })

  it('停用值日職務原子清除設定，版本支援 after_op，重新啟用仍為空', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const job = await createJob(client, classId)
    const jobId = job.payload.job_id
    const otherId = (await createJob(client, classId)).payload.job_id
    const initial = await commitOperation(client, setDutyJob(classId, jobId))
    const retired = await commitOperation(client, retireJob(classId, jobId))
    expect(retired.changes.map(({ entity }) => entity)).toEqual(['job', 'setting'])
    expect(retired.changes[1]).toEqual({
      entity: 'setting', key: { key: 'dutyJobId' }, prev_rev: 1, rev: 2,
      prev_value: { value: jobId }, value: { value: null }, last_op_id: retired.op_id,
    })
    expect(await readDutySetting(client, classId)).toEqual({ rev: 2, value: null, last_op_id: retired.op_id })
    await commitOperation(client, saveJob(classId, job.payload, { rev: 2 }))
    expect(await readDutySetting(client, classId)).toEqual({ rev: 2, value: null, last_op_id: retired.op_id })
    expect(await submit(client, setDutyJob(classId, otherId, { rev: initial.changes[0].rev })))
      .toMatchObject({ code: 'STALE_STATE' })
    const next = await commitOperation(client, setDutyJob(classId, otherId, { after_op: retired.op_id }))
    expect(next.changes).toMatchObject([{ rev: 3, value: { value: otherId } }])
    const retiredOther = await commitOperation(client, retireJob(classId, jobId, { rev: 3 }))
    expect(retiredOther.changes.map(({ entity }) => entity)).toEqual(['job'])
    expect(await readDutySetting(client, classId)).toEqual({ rev: 3, value: otherId, last_op_id: next.op_id })
  })
})
