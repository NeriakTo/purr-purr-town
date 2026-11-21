import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { buildV2App } from '../app.js'
import { openWebTestDatabase } from './database.js'
import { createTestClass, createTestSession, createTestTeacher } from './fixtures.js'

export const readTestTime = '2026-11-22T08:00:00.000Z'

export function useReadFixtures() {
  let database
  let pool
  let fixture
  const apps = []

  function makeApp(options = {}) {
    const app = buildV2App({ pool, clock: () => new Date(readTestTime), ...options })
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
    const target = await createTestClass(client, { owner: teacher })
    const token = await createTestSession(client, teacher.id, { expiresAt: new Date('2027-02-01') })
    fixture = { client, pool, teacher, target, token, makeApp, app: makeApp() }
  })

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
  })

  afterAll(async () => database?.close(), 15000)

  return () => fixture
}

export function sendRead(fixture, endpoint, payload, options = {}) {
  const { app = fixture.app, token = fixture.token } = options
  return app.inject({
    method: 'POST',
    url: '/api/v2/read/' + endpoint,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...options.headers,
    },
    payload,
  })
}

export async function readWriteBaseline(client) {
  const { rows: [baseline] } = await client.query(`
    SELECT
      (SELECT count(*) FROM ppt.operations) AS operations,
      (SELECT count(*) FROM ppt.transactions) AS transactions,
      (SELECT jsonb_object_agg(class_id, class_seq) FROM ppt.classes) AS sequences,
      (SELECT jsonb_object_agg(class_id, last_export_at) FROM ppt_web_state.class_exports) AS exports,
      (SELECT jsonb_object_agg(token_hash, to_jsonb(s)) FROM ppt_web_state.sessions s) AS sessions
  `)
  return baseline
}
