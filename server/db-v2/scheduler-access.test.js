import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { agentSubmit, authorizeAgent } from './test-support/agent.js'
import { classSnapshot } from './test-support/checks.js'
import { taipeiDayOffset } from './test-support/correction-rounds.js'
import { addClass, adjustment, cancel, classSequence, operationCount, submit } from './test-support/operations.js'
import { authorizeScheduler, offsetDay, overdueOperation, scheduler } from './test-support/scheduler.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function schedulerFixture(client, status = 'active') {
  const target = await addClass(client, { status })
  await authorizeScheduler(client, target.classId)
  const date = await taipeiDayOffset(client, 0)
  return { target, date, op: overdueOperation(target.classId, date) }
}

async function waitForClassLock(observer, worker, locker) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const { rows: [{ blocked }] } = await observer.query(
      'SELECT $2 = ANY(pg_blocking_pids($1)) AS blocked', [worker.processID, locker.processID],
    )
    if (blocked) return
  }
  throw new Error('未觀察到排程等候班級鎖')
}

describeDatabase('訂正逾期排程身分', () => {
  const db = useTestDatabase()

  test('授權排程接受臺灣當日與 v5，記錄身分並取得序號', async () => {
    const { client } = db()
    const { target, op } = await schedulerFixture(client)
    const before = await classSnapshot(client, target.classId, { ignoreClassSequence: true })
    expect(await submit(client, op, scheduler)).toMatchObject({
      status: 'committed', class_seq: 1, result: { noop: true }, changes: [],
    })
    const { rows } = await client.query(
      'SELECT actor_kind, actor_id FROM ppt.operations WHERE op_id = $1', [op.op_id],
    )
    expect(rows).toEqual([{ actor_kind: 'scheduler', actor_id: 'scheduler' }])
    expect(await classSnapshot(client, target.classId, { ignoreClassSequence: true })).toBe(before)
  })

  test('老師與小野不可先占用排程的 v5 編號', async () => {
    const { client } = db()
    const { target, op } = await schedulerFixture(client)
    const { classId } = target
    await authorizeAgent(client, classId)
    const before = await classSnapshot(client, classId)
    const count = await operationCount(client)
    const teacherOp = { ...adjustment(target), op_id: op.op_id }
    const { class_id: _classId, ...agentOp } = teacherOp
    const { class_id: _validClassId, ...validAgentOp } = adjustment(target)
    expect(await submit(client, teacherOp)).toMatchObject({ status: 'retry', code: 'INVALID_OP_ID' })
    expect(await cancel(client, classId, op.op_id)).toMatchObject({ status: 'retry', code: 'INVALID_OP_ID' })
    expect(await agentSubmit(client, classId, [validAgentOp, agentOp]))
      .toMatchObject({ status: 'retry', code: 'INVALID_OP_ID' })
    expect(await operationCount(client)).toBe(count)
    expect(await classSnapshot(client, classId)).toBe(before)
    expect(await submit(client, op, scheduler)).toMatchObject({ status: 'committed', code: 'OK' })
  })

  test('排程同編號同日期重播，改日期回 OP_ID_REUSED', async () => {
    const { client } = db()
    const { op, date } = await schedulerFixture(client)
    const first = await submit(client, op, scheduler)
    expect(first).toMatchObject({ status: 'committed', replayed: false })
    expect(await submit(client, op, scheduler)).toEqual({ ...first, replayed: true })
    expect(await submit(client, { ...op, payload: { date: offsetDay(date, -1) } }, scheduler))
      .toEqual({ op_id: op.op_id, status: 'retry', code: 'OP_ID_REUSED' })
  })

  test.each(['v4', '大寫', '無效變體'])('排程拒絕 %s 編號且不登記', async (format) => {
    const { client } = db()
    const { op } = await schedulerFixture(client)
    const validId = 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa'
    const opId = { v4: randomUUID(), 大寫: validId.toUpperCase(), 無效變體: validId.replace('-8aaa-', '-7aaa-') }[format]
    const count = await operationCount(client)
    expect(await submit(client, { ...op, op_id: opId }, scheduler))
      .toEqual({ op_id: opId, status: 'retry', code: 'INVALID_OP_ID' })
    expect(await operationCount(client)).toBe(count)
  })

  test('未授權班與不存在的班收到相同的 CLASS_FORBIDDEN', async () => {
    const { client } = db()
    const { classId } = await addClass(client)
    const op = overdueOperation(classId, await taipeiDayOffset(client, 0))
    const count = await operationCount(client)
    const denied = await submit(client, op, scheduler)
    expect(denied).toEqual({ op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' })
    expect(await submit(client, { ...op, class_id: randomUUID() }, scheduler)).toEqual(denied)
    expect(await operationCount(client)).toBe(count)
  })

  test('排程等鎖時撤回授權，鎖內重驗擋下且未消耗序號', async () => {
    const { client, connect } = db()
    const { target: { classId }, op } = await schedulerFixture(client)
    const [locker, worker] = await Promise.all([connect(), connect()])
    const count = await operationCount(client)
    await locker.query('BEGIN')
    let pending
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [classId])
      pending = Promise.allSettled([submit(worker, op, scheduler)])
      await waitForClassLock(client, worker, locker)
      await locker.query("DELETE FROM ppt.class_authorizations WHERE class_id = $1 AND actor_kind = 'scheduler'", [classId])
      await locker.query('COMMIT')
    } catch (error) {
      await locker.query('ROLLBACK')
      await pending
      throw error
    }
    expect(await pending).toEqual([{
      status: 'fulfilled', value: { op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' },
    }])
    expect(await operationCount(client)).toBe(count)
    expect(await classSequence(client, classId)).toBe(0)
  }, 15000)

  test('無效排程身分、排程放棄與無效系統身分都回 22023', async () => {
    const { client } = db()
    const { target: { classId }, op } = await schedulerFixture(client)
    const count = await operationCount(client)
    await expect(submit(client, op, { kind: 'scheduler', id: 'fixture' })).rejects.toMatchObject({ code: '22023' })
    await expect(cancel(client, classId, op.op_id, scheduler)).rejects.toMatchObject({ code: '22023' })
    await expect(submit(client, op, { kind: 'system', id: 'fixture' }))
      .rejects.toMatchObject({ code: '22023' })
    expect(await operationCount(client)).toBe(count)
  })

  test('排程只准送 OP-52，老師和小野送 OP-52 都定案拒絕', async () => {
    const { client } = db()
    const { target, op } = await schedulerFixture(client)
    const { classId } = target
    await authorizeAgent(client, classId)
    const count = await operationCount(client)
    const denied = { status: 'rejected', code: 'FORBIDDEN_ROLE' }
    expect(await submit(client, { ...adjustment(target), op_id: op.op_id }, scheduler)).toMatchObject(denied)
    expect(await submit(client, { ...op, op_id: randomUUID() })).toMatchObject(denied)
    const { class_id: _classId, ...entry } = op
    expect(await agentSubmit(client, classId, [{ ...entry, op_id: randomUUID() }]))
      .toMatchObject({ receipts: [denied] })
    const { rows } = await client.query('SELECT status, code FROM ppt.operations WHERE op_id = $1', [op.op_id])
    expect(rows).toEqual([denied])
    expect(await operationCount(client)).toBe(count + 3)
  })

  test('封存班的排程定案回 CLASS_ARCHIVED', async () => {
    const { client } = db()
    const { op } = await schedulerFixture(client, 'archived')
    expect(await submit(client, op, scheduler)).toMatchObject({ status: 'rejected', code: 'CLASS_ARCHIVED' })
  })

  test.each(['缺日期', '無效日期', '多餘鍵', '有 expect'])('排程輸入 %s 回 INVALID_PAYLOAD', async (input) => {
    const { client } = db()
    const { op, date } = await schedulerFixture(client)
    const invalid = {
      缺日期: { payload: {} },
      無效日期: { payload: { date: date.slice(0, 8) + '32' } },
      多餘鍵: { payload: { date, extra: true } },
      '有 expect': { expect: null },
    }
    expect(await submit(client, { ...op, ...invalid[input] }, scheduler))
      .toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
  })
})
