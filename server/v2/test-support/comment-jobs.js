import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'
import { requestComment, saveComment } from '../../db-v2/test-support/comments.js'
import { submit } from '../../db-v2/test-support/operations.js'
import { buildV2App } from '../app.js'
import { openWebTestDatabase } from './database.js'
import { createTestClass, createTestSession, createTestTeacher } from './fixtures.js'
import { envelope, readOperation, sendOps } from './ops.js'
import { commentApplyId } from '../jobs/operation-ids.js'

export const names = ['假樣本甲', '測驗同儕乙', 'Fake PupilZ', '虛構轉出丁', '虛構封存戊']
export const observation = '觀察測試記號，假樣本甲／樣本甲／本甲／假　樣\t本甲／測驗同儕乙／驗同儕乙／儕乙／測 驗同儕乙／Fake PupilZ／akePupilZ／Lz／虛構轉出丁／構轉出丁／出丁／虛構封存戊／構封存戊／存戊'
export const generated = Object.freeze({ comment: '3號互助，13號也是', motto: '3號測試箴言', analysis: '3號測試分析', model: '測試模型' })

export function captureCommentLog() {
  const entries = []
  const stream = new Writable({
    write(chunk, encoding, done) {
      entries.push(JSON.parse(chunk.toString()))
      done()
    },
  })
  const logger = Fastify({ logger: { stream, base: null } }).log
  return { logger, entries }
}

export function controlCommentTimers() {
  const pending = new Map()
  let id = 0
  const timers = {
    setTimeout: vi.fn((callback, delay) => {
      const timer = ++id
      pending.set(timer, { callback, delay })
      return timer
    }),
    clearTimeout: vi.fn(timer => pending.delete(timer)),
  }

  function expire() {
    expect(pending.size).toBe(1)
    const [[timer, { callback }]] = pending
    pending.delete(timer)
    callback()
  }
  return { timers, pending, expire }
}

export function mockWalle(respond = () => generated) {
  const entered = Promise.withResolvers()
  const walle = vi.fn(async (input, { signal }) => {
    entered.resolve(signal)
    return respond(input, signal)
  })
  return { walle, entered: entered.promise }
}

export function useCommentFixtures() {
  let database
  let pool
  let fixture
  const apps = []

  function makeApp(options = {}) {
    const app = buildV2App({ pool, ...options })
    apps.push(app)
    return app
  }

  beforeAll(async () => {
    database = await openWebTestDatabase()
    pool = database.createWebsitePool()
  }, 15000)

  beforeEach(async () => {
    const { client } = database
    const teacher = createTestTeacher()
    const target = await createTestClass(client, {
      owner: teacher, students: ['enrolled', 'enrolled', 'enrolled', 'transferred', 'archived'],
    })
    for (const [index, name] of names.entries()) {
      await client.query(
        'UPDATE ppt.students SET name = $1, seat_number = $2 WHERE class_id = $3 AND student_id = $4',
        [name, [3, 7, 9, 12, 15][index], target.classId, target.studentIds[index]],
      )
    }
    const saved = await submit(client, saveComment(target, { observation, comment: '老師的測試評語' }), teacher)
    expect(saved.status).toBe('committed')
    const token = await createTestSession(client, teacher.id)
    fixture = { database, pool, client, target, teacher, token, makeApp, request: requestComment(target, { rev: 1 }) }
  })

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
  })

  afterAll(async () => {
    await database?.close()
  }, 15000)

  return () => fixture
}

export async function sendCommentRequest(fixture, app, operation = fixture.request) {
  const response = await sendOps(fixture, envelope(fixture.target.classId, [operation]), { app })
  expect(response.statusCode).toBe(200)
  return response.json().receipts[0]
}

export function readCommentApplication(fixture, request = fixture.request) {
  return readOperation(fixture.client, commentApplyId(request.op_id))
}

export async function commentApplications({ client, target }) {
  const { rows } = await client.query(
    "SELECT op_id, payload FROM ppt.operations WHERE class_id = $1 AND type = 'comment.apply_generated'", [target.classId],
  )
  return rows
}
