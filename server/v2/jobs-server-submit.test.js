import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { authorizeScheduler, overdueOperation } from '../db-v2/test-support/scheduler.js'
import { commentApplyId, correctionOverdueId } from './jobs/operation-ids.js'
import { submitAsServer } from './jobs/server-submit.js'
import { openWebTestDatabase } from './test-support/database.js'
import { createTestClass } from './test-support/fixtures.js'

const scheduler = { kind: 'scheduler', id: 'scheduler' }
const system = { kind: 'system', id: 'system' }

test('內部送出拒絕非固定身分且不取得連線', async () => {
  const pool = { connect: vi.fn() }
  const op = { op_id: randomUUID() }
  const hiddenExtra = Object.defineProperty({ ...scheduler }, 'extra', { value: true })
  for (const actor of [
    { kind: 'teacher', id: 'teacher-fixture' }, { kind: 'scheduler', id: 'x' },
    { ...scheduler, extra: true }, { ...system, id: undefined }, hiddenExtra, null, undefined,
  ]) {
    await expect(submitAsServer(pool, {}, op, actor)).rejects.toBeInstanceOf(TypeError)
  }
  expect(pool.connect).not.toHaveBeenCalled()
})

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('網站帳號內部操作交易', () => {
  let db
  let pool
  beforeAll(async () => {
    db = await openWebTestDatabase()
    pool = db.createWebsitePool()
  }, 15000)
  afterAll(async () => db?.close())

  async function makeOverdue() {
    const { classId } = await createTestClass(db.client, { students: [] })
    await authorizeScheduler(db.client, classId)
    const date = '2026-11-15'
    return overdueOperation(classId, date, correctionOverdueId(classId, date))
  }

  async function readOperation(opId) {
    const { rows } = await db.client.query(
      'SELECT actor_kind, actor_id, status FROM ppt.operations WHERE op_id = $1', [opId],
    )
    return rows
  }

  test('固定排程身分可提交 OP-52 且操作紀錄保留排程身分', async () => {
    const op = await makeOverdue()
    expect(await submitAsServer(pool, {}, op, scheduler)).toMatchObject({
      op_id: op.op_id, status: 'committed', code: 'OK',
    })
    expect(await readOperation(op.op_id)).toEqual([
      { status: 'committed', actor_kind: 'scheduler', actor_id: 'scheduler' },
    ])
  })

  test('固定系統身分提交 OP-47 通過編號驗證並定案拒絕不存在的請求', async () => {
    const { classId, studentId } = await createTestClass(db.client)
    const requestOpId = randomUUID()
    const op = {
      op_id: commentApplyId(requestOpId), class_id: classId, type: 'comment.apply_generated',
      payload: { request_op_id: requestOpId, student_id: studentId, semester: '115-1', error: '測試錯誤' },
    }
    expect(await submitAsServer(pool, {}, op, system)).toMatchObject({
      op_id: op.op_id, status: 'rejected', code: 'NOT_FOUND',
    })
    expect(await readOperation(op.op_id)).toEqual([
      { status: 'rejected', actor_kind: 'system', actor_id: 'system' },
    ])
  })

  test('交易內提交前鉤子失敗會回復並回 INTERNAL_ERROR', async () => {
    const op = await makeOverdue()
    let visibleBeforeCommit
    const beforeServerCommit = vi.fn(async () => {
      visibleBeforeCommit = await readOperation(op.op_id)
      throw new Error('測試交易內失敗')
    })
    expect(await submitAsServer(pool, {}, op, scheduler, { beforeServerCommit }))
      .toEqual({ op_id: op.op_id, status: 'retry', code: 'INTERNAL_ERROR' })
    expect(beforeServerCommit.mock.calls).toEqual([[op]])
    expect(visibleBeforeCommit).toEqual([])
    expect(await readOperation(op.op_id)).toEqual([])
  })

  test('等班級鎖逾時回 SERVER_BUSY 且不保留紀錄', async () => {
    const op = await makeOverdue()
    const locker = await db.connect()
    await locker.query('BEGIN')
    try {
      await locker.query('SELECT 1 FROM ppt.classes WHERE class_id = $1 FOR UPDATE', [op.class_id])
      expect(await submitAsServer(pool, { lockTimeoutMs: 50 }, op, scheduler))
        .toEqual({ op_id: op.op_id, status: 'retry', code: 'SERVER_BUSY' })
      expect(await readOperation(op.op_id)).toEqual([])
    } finally {
      await locker.query('ROLLBACK')
    }
  })
})
