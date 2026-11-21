import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'
import { adjustment, classSequence } from '../db-v2/test-support/operations.js'
import { createClass } from '../db-v2/test-support/class-create.js'
import { assertNoOperationWrites, assertNoWrites, envelope, retry, sendOps, useOpsFixtures } from './test-support/ops.js'

async function lockClass(database, classId) {
  const locker = await database.connect()
  await locker.query('BEGIN')
  await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [classId])
  return locker
}

async function waitForSubmitLock(client, lockerPid) {
  const timeout = performance.now() + 2000
  while (performance.now() < timeout) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%ppt.submit_operation(%' AND $1 = ANY(pg_blocking_pids(pid))
    `, [lockerPid])
    if (rowCount > 0) return
    await delay(10)
  }
  throw new Error('未觀察到操作等待班級鎖')
}

function expectStopped(response, ops, code) {
  expect(response.statusCode).toBe(200)
  expect(response.json().receipts).toEqual([
    retry(ops[0].op_id, code), retry(ops[1].op_id ?? null, 'NOT_PROCESSED'),
  ])
}

async function getSubmittingPid(client) {
  const { rows } = await client.query(`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND state = 'idle in transaction'
      AND query LIKE 'SELECT ppt.submit_operation(%'
  `)
  expect(rows).toHaveLength(1)
  return rows[0].pid
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('提交操作的交易邊界', () => {
  const fixture = useOpsFixtures()

  test.each([
    ['等鎖', { lockTimeoutMs: 200 }],
    ['語句', { statementTimeoutMs: 200 }],
  ])('%s 200 毫秒逾時，放鎖前不處理後一筆，放鎖後同本文可重送', async (label, config) => {
    const context = fixture()
    const { client, database, target } = context
    const ops = [adjustment(target), adjustment(target)]
    const body = envelope(target.classId, ops)
    const app = context.makeApp({ config })
    const locker = await lockClass(database, target.classId)
    try {
      const start = performance.now()
      const response = await sendOps(context, body, { app })
      console.info(`T-607 ${label}逾時 HTTP 耗時 ${(performance.now() - start).toFixed(1)} 毫秒`)
      expectStopped(response, ops, 'SERVER_BUSY')
      await assertNoWrites(client, target.classId)
    } finally {
      await locker.query('ROLLBACK')
    }
    const repeated = await sendOps(context, body, { app })
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json().receipts.map(({ status }) => status)).toEqual(['committed', 'committed'])
    expect(repeated.json().class_seq).toBe(2)
  }, 8000)

  test('實際等到班級鎖後失去擁有權，停止批次且不推進序號', async () => {
    const context = fixture()
    const { client, database, target, teacher } = context
    const ops = [adjustment(target), adjustment(target)]
    const before = await classSequence(client, target.classId)
    const locker = await lockClass(database, target.classId)
    const pending = sendOps(context, envelope(target.classId, ops))
    try {
      await waitForSubmitLock(client, locker.processID)
      await locker.query('DELETE FROM ppt.class_ownership WHERE class_id = $1 AND teacher_id = $2', [
        target.classId, teacher.id,
      ])
      await locker.query('COMMIT')
      expectStopped(await pending, ops, 'CLASS_FORBIDDEN')
      expect(await classSequence(client, target.classId)).toBe(before)
      await assertNoWrites(client, target.classId)
    } finally {
      await locker.query('ROLLBACK')
      await pending
    }
  }, 8000)

  test('提交前鉤子拋錯會回復且不提早回成立收據，移除鉤子可重送', async () => {
    const context = fixture()
    const { client, target } = context
    const ops = [adjustment(target), adjustment(target)]
    const body = envelope(target.classId, ops)
    let submittingPid
    const beforeCommit = vi.fn(async () => {
      submittingPid = await getSubmittingPid(client)
      throw new Error('測試提交前錯誤')
    })
    const app = context.makeApp({ hooks: { beforeCommit } })
    expectStopped(await sendOps(context, body, { app }), ops, 'INTERNAL_ERROR')
    expect(beforeCommit.mock.calls).toEqual([[ops[0]]])
    expect(submittingPid).toBeGreaterThan(0)
    await assertNoWrites(client, target.classId)
    expect(await classSequence(client, target.classId)).toBe(0)
    const repeated = await sendOps(context, body)
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json().receipts.map(({ status }) => status)).toEqual(['committed', 'committed'])
  })

  test('提交時連線中斷回 INTERNAL_ERROR 並丟棄連線，同編號可重送', async () => {
    const context = fixture()
    const { client, database, target } = context
    const ops = [adjustment(target), adjustment(target)]
    const body = envelope(target.classId, ops)
    const pool = database.createPool()
    const released = vi.fn()
    pool.on('release', released)
    let terminated = false
    const app = context.makeApp({
      pool,
      hooks: {
        async beforeCommit() {
          const pid = await getSubmittingPid(client)
          const result = await client.query('SELECT pg_terminate_backend($1, 1000) AS terminated', [pid])
          terminated = result.rows[0].terminated
        },
      },
    })
    expectStopped(await sendOps(context, body, { app }), ops, 'INTERNAL_ERROR')
    expect(terminated).toBe(true)
    expect(released.mock.calls.some(([error]) => error?.code === 'INTERNAL_ERROR')).toBe(true)
    await assertNoWrites(client, target.classId)
    const repeated = await sendOps(context, body)
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json().receipts.map(({ status }) => status)).toEqual(['committed', 'committed'])
  })

  test('後一筆失敗時仍回前一筆已提交的收據，略過筆沒編號時回 null', async () => {
    const context = fixture()
    const { client, target } = context
    const [first, second] = [adjustment(target), adjustment(target)]
    const beforeCommit = vi.fn(op => {
      if (op.op_id === second.op_id) throw new Error('測試後續提交失敗')
    })
    const app = context.makeApp({ hooks: { beforeCommit } })
    const response = await sendOps(context, envelope(target.classId, [first, second, {}]), { app })
    expect(response.statusCode).toBe(200)
    const { receipts, class_seq: seq } = response.json()
    expect(receipts[0]).toMatchObject({ op_id: first.op_id, status: 'committed' })
    expect(receipts.slice(1)).toEqual([retry(second.op_id, 'INTERNAL_ERROR'), retry(null, 'NOT_PROCESSED')])
    expect(beforeCommit).toHaveBeenCalledTimes(2)
    expect(seq).toBe(1)
    await assertNoOperationWrites(client, second.op_id)
    const { rowCount } = await client.query('SELECT 1 FROM ppt.operations WHERE class_id = $1', [target.classId])
    expect(rowCount).toBe(1)
  })

  test('資料庫預設 repeatable read 時仍以 read committed 成立', async () => {
    const context = fixture()
    const { client, database, target } = context
    // database.name 由測試資料庫產生器生成。
    await client.query(`ALTER DATABASE ${database.name} SET default_transaction_isolation TO 'repeatable read'`)
    const pool = database.createPool()
    const app = context.makeApp({ pool })
    const { rows: [row] } = await pool.query('SHOW default_transaction_isolation')
    expect(row.default_transaction_isolation).toBe('repeatable read')
    const response = await sendOps(context, envelope(target.classId, [adjustment(target)]), { app })
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0]).toMatchObject({ status: 'committed', code: 'OK' })
  })

  test('定案拒絕的建班只有操作紀錄，頂層 class_seq 為 null', async () => {
    const context = fixture()
    const { client } = context
    const op = createClass(101)
    const response = await sendOps(context, envelope(op.class_id, [op]))
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      class_seq: null, receipts: [{ op_id: op.op_id, status: 'rejected', code: 'INVALID_PAYLOAD' }],
    })
    const { rowCount } = await client.query('SELECT 1 FROM ppt.classes WHERE class_id = $1', [op.class_id])
    expect(rowCount).toBe(0)
    expect(await client.query('SELECT 1 FROM ppt.operations WHERE class_id = $1', [op.class_id]))
      .toMatchObject({ rowCount: 1 })
    const transactions = await client.query('SELECT 1 FROM ppt.transactions WHERE class_id = $1', [op.class_id])
    expect(transactions.rowCount).toBe(0)
  })
})
