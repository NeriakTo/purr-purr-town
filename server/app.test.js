import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- 記憶體假資料庫：模型化 classes / class_ownership / class_snapshots ---
// 只支援 handler 實際下的那幾條 SQL，用字串比對路由。

function makeFakeDb() {
  const classes = new Map()        // id -> row
  const ownership = new Set()       // `${classId}::${teacherId}`
  const snapshots = new Map()       // classId -> { payload, version, updated_at }

  function run(text, params = []) {
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
    throw new Error('未預期的 SQL: ' + t)
  }

  const pool = {
    connect: async () => ({ query: async (text, params) => run(text, params), release: () => {} }),
  }
  return { query: async (text, params) => run(text, params), pool, _state: { classes, ownership, snapshots } }
}

const fake = makeFakeDb()

// db.js：以假引擎替換（避免真連 Postgres，也避免 DB_PASSWORD 檢查）
vi.mock('./db.js', () => ({
  default: fake.pool,
  query: (text, params) => fake.query(text, params),
}))

// auth.js：validateToken('valid:X') → 'X'，其餘 → null；其他函式測試用不到
vi.mock('./auth.js', () => ({
  validateToken: async (raw) => (raw?.startsWith('valid:') ? raw.slice(6) : null),
  hashPasscode: async () => 'h',
  verifyPasscode: async () => true,
  createSession: async () => 'tok',
  destroySession: async () => {},
  cleanExpiredSessions: async () => {},
}))

const { buildApp } = await import('./app.js')

function auth(teacher) {
  return { authorization: `Bearer valid:${teacher}` }
}

describe('班級擁有權授權', () => {
  let app
  beforeEach(async () => {
    fake._state.classes.clear()
    fake._state.ownership.clear()
    fake._state.snapshots.clear()
    app = await buildApp()
  })

  it('teacherA 建班後成為擁有者', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/classes',
      headers: auth('A'), payload: { id: 'c1', name: '一班' },
    })
    expect(res.statusCode).toBe(200)
    expect(fake._state.ownership.has('c1::A')).toBe(true)
  })

  it('teacherB 不能用既有班級代號奪取 teacherA 的班（回 409，不加擁有者）', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
    const res = await app.inject({
      method: 'POST', url: '/api/v1/classes',
      headers: auth('B'), payload: { id: 'c1', name: '惡意改名' },
    })
    expect(res.statusCode).toBe(409)
    expect(fake._state.ownership.has('c1::B')).toBe(false)
    // teacherA 的班名沒有被 B 改寫
    expect(fake._state.classes.get('c1').name).toBe('一班')
    // c1 只有 A 一位擁有者（無第二擁有者）
    const owners = [...fake._state.ownership].filter(k => k.startsWith('c1::'))
    expect(owners).toEqual(['c1::A'])
  })

  it('teacherA 可重複 POST 自己的班（更新，不算奪取）', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
    const res = await app.inject({
      method: 'POST', url: '/api/v1/classes',
      headers: auth('A'), payload: { id: 'c1', name: '一班改名' },
    })
    expect(res.statusCode).toBe(200)
    expect(fake._state.classes.get('c1').name).toBe('一班改名')
  })

  it('teacherB 不能讀 teacherA 班級的快照（403）', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
    await app.inject({ method: 'PUT', url: '/api/v1/snapshots/c1', headers: auth('A'), payload: { payload: { students: [] }, version: 0 } })
    const res = await app.inject({ method: 'GET', url: '/api/v1/snapshots/c1', headers: auth('B') })
    expect(res.statusCode).toBe(403)
  })

  it('teacherB 不能寫 teacherA 班級的快照（403）', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
    const res = await app.inject({ method: 'PUT', url: '/api/v1/snapshots/c1', headers: auth('B'), payload: { payload: { students: [] }, version: 0 } })
    expect(res.statusCode).toBe(403)
  })

  it('teacherB 不能查 teacherA 班級的版本（403）— 修補漏驗的端點', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
    const res = await app.inject({ method: 'GET', url: '/api/v1/snapshots/c1/version', headers: auth('B') })
    expect(res.statusCode).toBe(403)
  })

  it('無 token 一律 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/classes' })
    expect(res.statusCode).toBe(401)
  })

  it('過期／無效 token 401（session 端點）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { authorization: 'Bearer bad' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('快照版本樂觀鎖', () => {
  let app
  beforeEach(async () => {
    fake._state.classes.clear()
    fake._state.ownership.clear()
    fake._state.snapshots.clear()
    app = await buildApp()
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers: auth('A'), payload: { id: 'c1', name: '一班' } })
  })

  it('落後版本推送回 409 並附 serverVersion', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/snapshots/c1', headers: auth('A'), payload: { payload: { students: [] }, version: 0 } }) // → v1
    await app.inject({ method: 'PUT', url: '/api/v1/snapshots/c1', headers: auth('A'), payload: { payload: { students: [] }, version: 1 } }) // → v2
    const stale = await app.inject({ method: 'PUT', url: '/api/v1/snapshots/c1', headers: auth('A'), payload: { payload: { students: [] }, version: 0 } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().serverVersion).toBe(2)
  })
})
