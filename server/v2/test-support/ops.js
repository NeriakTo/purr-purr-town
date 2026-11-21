import { afterAll, beforeAll, beforeEach, expect } from 'vitest'
import { createTestApp } from './app.js'
import { openWebTestDatabase } from './database.js'
import { createTestClass, createTestSession, createTestTeacher } from './fixtures.js'

export const serverTime = '2026-11-21T08:00:00.000Z'

export function useOpsFixtures() {
  let database
  let fixture
  const apps = []

  function makeApp(options = {}) {
    const app = createTestApp(database, { clock: () => new Date(serverTime), ...options })
    apps.push(app)
    return app
  }

  beforeAll(async () => {
    database = await openWebTestDatabase()
  }, 15000)

  beforeEach(async () => {
    const { client } = database
    const teacher = createTestTeacher()
    const target = await createTestClass(client, { owner: teacher })
    const token = await createTestSession(client, teacher.id, { expiresAt: new Date('2027-01-01') })
    fixture = { database, client, teacher, target, token, app: makeApp(), makeApp }
  })

  afterAll(async () => {
    try {
      await Promise.all(apps.map(app => app.close()))
    } finally {
      await database?.close()
    }
  }, 15000)

  return () => fixture
}

export function envelope(classId, ops, fields = {}) {
  return { v: 1, class_id: classId, ops, ...fields }
}

export function sendOps(fixture, payload, options = {}) {
  const { app = fixture.app, token = fixture.token } = options
  return app.inject({
    method: 'POST', url: '/api/v2/ops',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...options.headers,
    },
    payload,
  })
}

export async function readOperation(client, opId) {
  const { rows: [row] } = await client.query('SELECT * FROM ppt.operations WHERE op_id = $1', [opId])
  return row
}

export async function assertNoWrites(client, ...classIds) {
  const { rows: [counts] } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM ppt.operations WHERE class_id = ANY($1)) AS operations,
      (SELECT count(*)::int FROM ppt.transactions WHERE class_id = ANY($1)) AS transactions
  `, [classIds])
  expect(counts).toEqual({ operations: 0, transactions: 0 })
}

export async function assertNoOperationWrites(client, ...opIds) {
  const { rows: [counts] } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM ppt.operations WHERE op_id = ANY($1)) AS operations,
      (SELECT count(*)::int FROM ppt.transactions WHERE op_id = ANY($1)) AS transactions
  `, [opIds])
  expect(counts).toEqual({ operations: 0, transactions: 0 })
}

export async function assertNoOperationTransactions(client, opId) {
  const { rowCount } = await client.query('SELECT 1 FROM ppt.transactions WHERE op_id = $1', [opId])
  expect(rowCount).toBe(0)
}

export function retry(opId, code) {
  return { op_id: opId, status: 'retry', code }
}
