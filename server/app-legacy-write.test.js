import { it, expect, beforeEach, afterEach, vi } from 'vitest'

// --- 記憶體假資料庫：模型化 classes / class_ownership / class_snapshots ---
// 只支援 handler 實際下的那幾條 SQL，用字串比對路由。

function makeFakeDb() {
  const classes = new Map()        // id -> row
  const ownership = new Set()       // `${classId}::${teacherId}`
  const snapshots = new Map()       // classId -> { payload, version, updated_at }

  const statements = []
  const teachers = new Map([["測試老師甲", { id: "A", passcode_hash: "test-hash" }]])

  function run(text, params = []) {
    statements.push(text)
    const t = text.replace(/\s+/g, ' ').trim()

    if (t.startsWith('BEGIN') || t.startsWith('COMMIT') || t.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 }
    }
    if (t.startsWith('SELECT id FROM classes WHERE id')) {
      const [id] = params
      return { rows: classes.has(id) ? [{ id }] : [], rowCount: classes.has(id) ? 1 : 0 }
    }
    if (t.startsWith('SELECT 1 FROM class_ownership WHERE class_id')) {
      const [cid, tid] = params
      const has = ownership.has(`${cid}::${tid}`)
      return { rows: has ? [{ '?column?': 1 }] : [], rowCount: has ? 1 : 0 }
    }
    // 原子式建班：ON CONFLICT DO NOTHING RETURNING — 已存在則不插入、回 rowCount 0
    if (t.startsWith('INSERT INTO classes')) {
      const [id, year, name, teacher, alias, status, studentCount] = params
      if (classes.has(id)) {
        return { rows: [], rowCount: 0 } // 已存在，DO NOTHING
      }
      classes.set(id, { id, year, name, teacher, alias, status, student_count: studentCount })
      return { rows: [{ id }], rowCount: 1 }
    }
    if (t.startsWith('UPDATE classes SET year')) {
      const [id, year, name, teacher, alias, status, studentCount] = params
      const row = classes.get(id)
      if (row) classes.set(id, { ...row, year, name, teacher, alias, status, student_count: studentCount })
      return { rows: [], rowCount: row ? 1 : 0 }
    }
    if (t.startsWith('INSERT INTO class_ownership')) {
      const [cid, tid] = params
      // 模擬 uq_class_ownership_class 單一擁有者唯一索引：若已有其他老師擁有，違反約束
      const existingOwner = [...ownership].find(k => k.startsWith(`${cid}::`))
      if (existingOwner && existingOwner !== `${cid}::${tid}`) {
        throw new Error('duplicate key value violates unique constraint "uq_class_ownership_class"')
      }
      ownership.add(`${cid}::${tid}`)
      return { rows: [], rowCount: 1 }
    }
    if (t.startsWith('DELETE FROM classes WHERE id')) {
      const [id] = params
      classes.delete(id)
      return { rows: [], rowCount: 1 }
    }
    if (t.startsWith('SELECT payload, version, updated_at FROM class_snapshots')) {
      const [cid] = params
      const s = snapshots.get(cid)
      return { rows: s ? [{ payload: s.payload, version: s.version, updated_at: s.updated_at }] : [], rowCount: s ? 1 : 0 }
    }
    if (t.startsWith('SELECT version, updated_at FROM class_snapshots')) {
      const [cid] = params
      const s = snapshots.get(cid)
      return { rows: s ? [{ version: s.version, updated_at: s.updated_at }] : [], rowCount: s ? 1 : 0 }
    }
    if (t.startsWith('SELECT version FROM class_snapshots')) {
      const [cid] = params
      const s = snapshots.get(cid)
      return { rows: s ? [{ version: s.version }] : [], rowCount: s ? 1 : 0 }
    }
    if (t.startsWith('INSERT INTO class_snapshots')) {
      const [cid, payload, version, expectedMax] = params
      const cur = snapshots.get(cid)
      if (cur && cur.version > expectedMax) {
        return { rows: [], rowCount: 0 } // 版本衝突
      }
      snapshots.set(cid, { payload: JSON.parse(payload), version, updated_at: '2026-08-17T00:00:00Z' })
      return { rows: [{ version }], rowCount: 1 }
    }
    if (t.startsWith('UPDATE classes SET student_count')) {
      return { rows: [], rowCount: 1 }
    }
    if (t.startsWith('SELECT c.* FROM classes')) {
      return { rows: [...classes.values()].filter(row => ownership.has(row.id + '::' + params[0])) }
    }
    if (t.startsWith('SELECT id FROM teachers') || t.startsWith('SELECT id, passcode_hash FROM teachers')) {
      const row = teachers.get(params[0])
      return { rows: row ? [row] : [] }
    }
    if (t.startsWith('INSERT INTO teachers')) {
      const [id, name, passcode_hash] = params
      teachers.set(name, { id, passcode_hash })
      return { rowCount: 1 }
    }
    if (t.startsWith('SELECT t.name, s.expires_at')) {
      return { rows: [{ name: '測試老師甲', expires_at: '2026-12-01T00:00:00Z' }] }
    }
    throw new Error('未預期的 SQL: ' + t)
  }

  const pool = {
    connect: async () => ({ query: async (text, params) => run(text, params), release: () => {} }),
  }
  return { statements, teachers, query: async (text, params) => run(text, params), pool, _state: { classes, ownership, snapshots } }
}

const fake = makeFakeDb()

// db.js：以假引擎替換（避免真連 Postgres，也避免 DB_PASSWORD 檢查）
vi.mock('./db.js', () => ({
  default: fake.pool,
  query: (text, params) => fake.query(text, params),
}))

// auth.js：validateToken('valid:X') → 'X'，其餘 → null；其他函式測試用不到
vi.mock('./auth.js', () => ({
  validateToken: vi.fn(async (raw) => (raw?.startsWith('valid:') ? raw.slice(6) : null)),
  hashPasscode: async () => 'h',
  verifyPasscode: async () => true,
  createSession: async () => 'tok',
  destroySession: vi.fn(async () => {}),
  cleanExpiredSessions: async () => {},
}))

const { buildApp } = await import('./app.js')

function auth(teacher) {
  return { authorization: `Bearer valid:${teacher}` }
}

const { validateToken, destroySession } = await import('./auth.js')
const apps = []
const writeKey = 'LEGACY_WRITE_CLOSED'
const registerKey = 'LEGACY_REGISTER_CLOSED'
const writes = [
  { method: 'POST', url: '/api/v1/classes', payload: { id: 'c1', name: '測試班級' }, sql: 'UPDATE classes SET' },
  { method: 'PUT', url: '/api/v1/snapshots/c1', payload: { payload: { students: [] }, version: 0 }, sql: 'INSERT INTO class_snapshots' },
  { method: 'DELETE', url: '/api/v1/classes/c1', sql: 'DELETE FROM classes' },
]
const register = {
  method: 'POST', url: '/api/v1/auth/register', payload: { name: '測試老師乙', passcode: 'test-passcode' },
}
const closedWrite = {
  success: false, error: '舊版已停止寫入，請重新整理網頁改用新版', code: 'LEGACY_WRITE_CLOSED',
}
const closedRegister = { ...closedWrite, error: '舊版已停止開新帳號' }

beforeEach(() => {
  vi.stubEnv(writeKey, undefined)
  vi.stubEnv(registerKey, undefined)
  fake.statements.length = 0
  fake._state.classes.clear()
  fake._state.ownership.clear()
  fake._state.snapshots.clear()
  fake.teachers.delete('測試老師乙')
  fake._state.classes.set('c1', { id: 'c1', name: '測試原班級' })
  fake._state.ownership.add('c1::A')
  vi.clearAllMocks()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(apps.splice(0).map(app => app.close()))
})

async function makeApp(options) {
  const app = await buildApp(options)
  apps.push(app)
  return app
}

function injectWrite(app, { sql: _sql, ...request }, headers) {
  return app.inject({ ...request, headers })
}

function expectClosed(response, body) {
  expect(response.statusCode).toBe(410)
  expect(typeof response.json().error).toBe('string')
  expect(response.json()).toEqual(body)
}

async function expectWritesOpen(app) {
  for (const write of writes) {
    const start = fake.statements.length
    const response = await injectWrite(app, write, auth('A'))
    expect(response.statusCode).toBe(200)
    expect(response.json().success).toBe(true)
    expect(fake.statements.slice(start).some(sql => sql.startsWith(write.sql))).toBe(true)
  }
}

it('寫入關閉時三條路由對所有權杖都回 410 且不驗權杖或查庫', async () => {
  const app = await makeApp({ legacyWriteClosed: true })
  for (const write of writes) {
    for (const headers of [auth('A'), auth('B'), undefined]) {
      expectClosed(await injectWrite(app, write, headers), closedWrite)
    }
  }
  expect(validateToken).not.toHaveBeenCalled()
  expect(fake.statements).toEqual([])
})

it('重送與超過舊版限流上限仍回 410', async () => {
  const app = await makeApp({ legacyWriteClosed: true, legacyRegisterClosed: true })
  for (let attempt = 0; attempt < 62; attempt++) {
    expectClosed(await injectWrite(app, writes[1], auth('A')), closedWrite)
    if (attempt < 12) expectClosed(await app.inject(register), closedRegister)
  }
  expect(fake.statements).toEqual([])
})

it('兩個開關打開時讀取、登入、登出及工作階段照常', async () => {
  const app = await makeApp({ legacyWriteClosed: true, legacyRegisterClosed: true })
  fake._state.snapshots.set('c1', { payload: { students: [] }, version: 2 })
  const get = (url, teacher = 'A') => app.inject({ url, headers: auth(teacher) })
  expect((await get('/api/v1/classes')).json()).toMatchObject({ success: true, data: [{ id: 'c1' }] })
  for (const url of ['/api/v1/snapshots/c1', '/api/v1/snapshots/c1/version']) {
    expect((await get(url)).statusCode).toBe(200)
    expect((await get(url)).json()).toMatchObject({ success: true, data: { version: 2 } })
    expect((await get(url, 'B')).statusCode).toBe(403)
  }
  const login = await app.inject({ ...register, url: '/api/v1/auth/login', payload: { ...register.payload, name: '測試老師甲' } })
  expect(login.statusCode).toBe(200)
  expect((await get('/api/v1/auth/session')).json()).toMatchObject({ success: true, data: { teacherId: 'A' } })
  expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: auth('A') })).statusCode).toBe(200)
  expect(destroySession).toHaveBeenCalledWith('valid:A')
})

it('預設兩個開關都關閉且三條寫入照常', async () => {
  const app = await makeApp()
  await expectWritesOpen(app)
  expect((await app.inject(register)).statusCode).toBe(200)
})

it('明帶 false 優先於環境變數且三條寫入照常', async () => {
  vi.stubEnv(writeKey, 'true')
  vi.stubEnv(registerKey, 'true')
  const app = await makeApp({ legacyWriteClosed: false, legacyRegisterClosed: false })
  await expectWritesOpen(app)
  expect((await app.inject(register)).statusCode).toBe(200)
})

it('只關寫入仍可註冊', async () => {
  const app = await makeApp({ legacyWriteClosed: true })
  expectClosed(await injectWrite(app, writes[0], auth('A')), closedWrite)
  expect((await app.inject(register)).statusCode).toBe(200)
})

it('只關註冊仍可寫入且註冊未查庫', async () => {
  const app = await makeApp({ legacyRegisterClosed: true })
  expectClosed(await app.inject(register), closedRegister)
  expect(fake.statements).toEqual([])
  await expectWritesOpen(app)
})

it('兩個環境變數的 true 分別關閉對應入口', async () => {
  vi.stubEnv(writeKey, 'true')
  vi.stubEnv(registerKey, 'true')
  const app = await makeApp()
  for (const write of writes) expectClosed(await injectWrite(app, write, auth('A')), closedWrite)
  expectClosed(await app.inject(register), closedRegister)
  expect(fake.statements).toEqual([])
})

it('兩個環境變數的空字串與 false 都保留舊行為', async () => {
  for (const value of ['', 'false']) {
    vi.stubEnv(writeKey, value)
    vi.stubEnv(registerKey, value)
    const app = await makeApp()
    expect((await injectWrite(app, writes[0], auth('A'))).statusCode).toBe(200)
    expect((await app.inject(register)).statusCode).toBe(200)
    fake.teachers.delete('測試老師乙')
  }
})

it('兩個環境變數拒絕 1、yes、TRUE 與尾端空白', async () => {
  for (const key of [writeKey, registerKey]) {
    for (const value of ['1', 'yes', 'TRUE', 'true ']) {
      vi.stubEnv(key, value)
      await expect(makeApp().then(() => undefined)).rejects.toThrow(key)
    }
    vi.stubEnv(key, undefined)
  }
})
