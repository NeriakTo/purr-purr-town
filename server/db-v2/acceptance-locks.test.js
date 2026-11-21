import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { classSnapshot } from './test-support/checks.js'
import { commitClass, createClass } from './test-support/class-create.js'
import {
  createInheritanceRaceClasses, prepareInheritanceRace, sendMixedClassOperations, updateInheritanceSource,
} from './test-support/class-locks.js'
import {
  addClass, adjustment, cancel, classSequence, operationCount, submit,
} from './test-support/operations.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function waitForLock(observer, waiter, locker) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const { rowCount } = await observer.query(`
      SELECT 1 FROM pg_stat_activity
      WHERE pid = $1 AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))
    `, [waiter.processID, locker.processID])
    if (rowCount === 1) return
    await delay(10)
  }
  throw new Error('未在 pg_stat_activity 觀察到預期的班級鎖等待')
}

async function submitWhileLocked(database, op, lock, whileWaiting) {
  const { client: observer, connect } = database
  const [locker, waiter] = await Promise.all([connect(), connect()])
  // Start the waiter's transaction first to distinguish lock time from transaction start.
  await waiter.query('BEGIN')
  await locker.query('BEGIN')
  let pending
  let first
  try {
    first = await lock(locker)
    pending = Promise.allSettled([submit(waiter, op)])
    await waitForLock(observer, waiter, locker)
    await whileWaiting(locker)
    await locker.query('COMMIT')
  } catch (error) {
    await locker.query('ROLLBACK')
    await pending
    await waiter.query('ROLLBACK')
    throw error
  }
  const [outcome] = await pending
  if (outcome.status === 'rejected') {
    await waiter.query('ROLLBACK')
    throw outcome.reason
  }
  await waiter.query('COMMIT')
  return { first, second: outcome.value }
}

async function sendAdjustments(client, fixture, offset) {
  for (let i = 0; i < 200; i += 1) {
    const studentId = fixture.studentIds[(i + offset) % fixture.studentIds.length]
    const op = adjustment({ ...fixture, studentId }, offset === 0 ? 1 : -1)
    expect(await submit(client, op)).toMatchObject({ status: 'committed', code: 'OK' })
  }
}

describeDatabase('班級鎖與交易驗收', () => {
  const db = useTestDatabase()

  test('兩連線各送兩百筆交錯操作，班級序號連號且無死結', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client, { students: ['enrolled', 'enrolled', 'home_study'] })
    const [left, right] = await Promise.all([connect(), connect()])
    const before = await classSequence(client, fixture.classId)
    const started = performance.now()
    await Promise.all([sendAdjustments(left, fixture, 0), sendAdjustments(right, fixture, 1)])
    const elapsed = performance.now() - started
    expect(await classSequence(client, fixture.classId)).toBe(before + 400)
    const { rows } = await client.query(`
      SELECT class_seq FROM ppt.operations
      WHERE class_id = $1 AND status = 'committed' ORDER BY class_seq
    `, [fixture.classId])
    expect(rows.map(({ class_seq }) => Number(class_seq))).toEqual(
      Array.from({ length: 400 }, (_, i) => before + i + 1),
    )
    console.log(`03:372 兩連線共 400 筆操作耗時 ${elapsed.toFixed(1)} ms`)
  }, 30000)

  test('呼叫端提交前同班操作確實等鎖，序號和時間依序遞增', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const earlier = adjustment(fixture)
    const later = adjustment(fixture)
    const { first, second } = await submitWhileLocked(
      db(), later,
      (locker) => submit(locker, earlier),
      async () => expect(await classSequence(client, fixture.classId)).toBe(0),
    )
    expect(first).toMatchObject({ status: 'committed', class_seq: 1 })
    expect(second).toMatchObject({ status: 'committed', class_seq: 2 })
    const { rows: [{ ordered }] } = await client.query(
      'SELECT $1::timestamptz < $2::timestamptz AS ordered', [first.committed_at, second.committed_at],
    )
    expect(ordered).toBe(true)
  }, 15000)

  test('repeatable read 下提交與放棄都拋例外且資料不變', async () => {
    const { client, connect } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const before = await classSnapshot(client, fixture.classId)
    const count = await operationCount(client)
    const worker = await connect()
    const calls = [
      () => submit(worker, op),
      () => cancel(worker, fixture.classId, op.op_id),
    ]
    for (const call of calls) {
      await worker.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      try {
        await expect(call()).rejects.toMatchObject({ code: '25000' })
      } finally {
        await worker.query('ROLLBACK')
      }
    }
    expect(await classSnapshot(client, fixture.classId)).toBe(before)
    expect(await operationCount(client)).toBe(count)
  })

  test('等鎖期間撤掉擁有者，鎖內重驗擋下且不登記編號', async () => {
    const { client } = db()
    const fixture = await addClass(client)
    const op = adjustment(fixture)
    const count = await operationCount(client)
    const { second } = await submitWhileLocked(
      db(), op,
      (locker) => locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [fixture.classId]),
      (locker) => locker.query('DELETE FROM ppt.class_ownership WHERE class_id = $1', [fixture.classId]),
    )
    expect(second).toEqual({ op_id: op.op_id, status: 'retry', code: 'CLASS_FORBIDDEN' })
    expect(await operationCount(client)).toBe(count)
    expect(await classSequence(client, fixture.classId)).toBe(0)
  }, 15000)

  test('03:372 兩連線各送兩百筆混合操作，成立序號連號', async () => {
    const { client, connect } = db()
    const { classId, studentIds, receipt } = await commitClass(client, createClass(6))
    const ruleId = receipt.changes.find(c => c.entity === 'rule' && c.value.kind === 'manual' && c.value.amount === 100)
      .key.rule_id
    const [left, right] = await Promise.all([connect(), connect()])
    const start = performance.now()
    const seq = await Promise.all([
      sendMixedClassOperations(left, classId, studentIds.slice(0, 3), ruleId, 0),
      sendMixedClassOperations(right, classId, studentIds.slice(3), ruleId, 1),
    ])
    console.log(`03:372 混合操作 400 筆耗時 ${(performance.now() - start).toFixed(1)} ms`)
    const { rows } = await client.query(`
      SELECT class_seq::int AS seq FROM ppt.operations
      WHERE class_id = $1 AND status = 'committed' ORDER BY class_seq
    `, [classId])
    expect(rows.map(row => row.seq)).toEqual(Array.from({ length: 371 }, (_, index) => index + 1))
    expect(seq.flat().sort((a, b) => a - b)).toEqual(rows.slice(1).map(row => row.seq))
    expect(await classSequence(client, classId)).toBe(rows.length)
  }, 60000)

  test('03:372 承接三十班與來源班一百五十筆寫入並行，承接資料一致', async () => {
    const { client, connect } = db()
    const source = await prepareInheritanceRace(client)
    const [creator, writer] = await Promise.all([connect(), connect()])
    const start = performance.now()
    const [classIds] = await Promise.all([
      createInheritanceRaceClasses(creator, source.classId), updateInheritanceSource(writer, source),
    ])
    console.log(`03:372 承接 30 班與來源寫入 150 筆耗時 ${(performance.now() - start).toFixed(1)} ms`)
    expect(new Set(classIds).size).toBe(30)
    const { rows } = await client.query(`
      SELECT c.class_id, c.class_seq::int,
        s.value #>> '{}' AS duty, j.job_id, j.disabled,
        ARRAY(SELECT event::text FROM ppt.rules r WHERE r.class_id = c.class_id AND r.kind = 'event' AND NOT r.disabled
          ORDER BY event::text) AS events
      FROM ppt.classes c
      LEFT JOIN ppt.settings_entries s ON s.class_id = c.class_id AND s.key = 'dutyJobId'
      LEFT JOIN ppt.jobs j ON j.class_id = c.class_id AND j.job_id = s.value #>> '{}'
      WHERE c.class_id = ANY($1::text[])
    `, [classIds])
    expect(rows).toHaveLength(30)
    for (const row of rows) {
      expect(row.class_seq).toBe(1)
      expect(row.events).toEqual(['daily_quest.complete', 'submission.late', 'submission.missing'])
      if (row.duty !== null) expect(row).toMatchObject({ job_id: row.duty, disabled: false })
    }
    expect(await classSequence(client, source.classId)).toBe(153)
  }, 60000)
})
