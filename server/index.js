import Fastify from 'fastify'
import cors from '@fastify/cors'
import pool, { query } from './db.js'
import { hashPasscode, verifyPasscode, createSession, validateToken, destroySession, cleanExpiredSessions } from './auth.js'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://neriakto.github.io').split(',')
const BODY_LIMIT = 5 * 1024 * 1024

const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT, trustProxy: true })

await app.register(cors, {
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
})

// --- Error handler ---

app.setErrorHandler((err, req, reply) => {
  app.log.error(err)
  reply.status(500).send({ success: false, error: '伺服器錯誤' })
})

// --- Rate limiting (in-memory, per IP) ---

const rateLimits = new Map()
const RATE_WINDOW_MS = 60_000
const RATE_MAX_AUTH = 10
const RATE_MAX_GENERAL = 60

function checkRateLimit(ip, bucket, max) {
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const entry = rateLimits.get(key)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(key, { windowStart: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= max
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) {
      rateLimits.delete(key)
    }
  }
}, RATE_WINDOW_MS)

// Health check
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

// --- Auth ---

app.post('/api/v1/auth/register', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'auth', RATE_MAX_AUTH)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁，請稍後再試' })
  }

  const { name, passcode } = req.body || {}
  if (!name || !passcode || passcode.length < 6) {
    return reply.status(400).send({ success: false, error: '名稱與密碼（至少 6 位）為必填' })
  }
  if (name.length > 50) {
    return reply.status(400).send({ success: false, error: '名稱過長' })
  }

  const existing = await query('SELECT id FROM teachers WHERE name = $1', [name])
  if (existing.rows.length > 0) {
    return reply.status(400).send({ success: false, error: '無法使用此名稱，請換一個' })
  }

  const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const hash = await hashPasscode(passcode)
  await query(
    'INSERT INTO teachers (id, name, passcode_hash) VALUES ($1, $2, $3)',
    [id, name, hash]
  )

  const token = await createSession(id)
  return { success: true, data: { teacherId: id, name, token } }
})

app.post('/api/v1/auth/login', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'auth', RATE_MAX_AUTH)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁，請稍後再試' })
  }

  const { name, passcode } = req.body || {}
  if (!name || !passcode) {
    return reply.status(400).send({ success: false, error: '名稱與密碼為必填' })
  }

  const result = await query('SELECT id, passcode_hash FROM teachers WHERE name = $1', [name])
  if (result.rows.length === 0) {
    return reply.status(401).send({ success: false, error: '帳號或密碼錯誤' })
  }

  const teacher = result.rows[0]
  const valid = await verifyPasscode(passcode, teacher.passcode_hash)
  if (!valid) {
    return reply.status(401).send({ success: false, error: '帳號或密碼錯誤' })
  }

  const token = await createSession(teacher.id)
  return { success: true, data: { teacherId: teacher.id, name, token } }
})

app.post('/api/v1/auth/logout', async (req, reply) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return { success: true }
  }
  const raw = auth.slice(7)
  await destroySession(raw)
  return { success: true }
})

// --- Auth middleware ---

async function authenticate(req, reply) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.status(401).send({ success: false, error: '未授權' })
    return null
  }
  const raw = auth.slice(7)
  const teacherId = await validateToken(raw)
  if (!teacherId) {
    reply.status(401).send({ success: false, error: 'Token 無效或已過期' })
    return null
  }
  return teacherId
}

// --- Classes ---

app.get('/api/v1/classes', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const result = await query(
    `SELECT c.* FROM classes c
     JOIN class_ownership co ON c.id = co.class_id
     WHERE co.teacher_id = $1
     ORDER BY c.created_at DESC`,
    [teacherId]
  )
  return { success: true, data: result.rows }
})

app.post('/api/v1/classes', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const { id, year, name, teacher, alias, status, studentCount } = req.body || {}
  if (!id || !name) {
    return reply.status(400).send({ success: false, error: 'id 和 name 為必填' })
  }
  if (id.length > 100 || name.length > 100) {
    return reply.status(400).send({ success: false, error: '欄位過長' })
  }

  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')
    await conn.query(
      `INSERT INTO classes (id, year, name, teacher, alias, status, student_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         year = EXCLUDED.year, name = EXCLUDED.name, teacher = EXCLUDED.teacher,
         alias = EXCLUDED.alias, status = EXCLUDED.status, student_count = EXCLUDED.student_count,
         updated_at = NOW()`,
      [id, year || '', name, teacher || '', alias || '', status || 'active', studentCount || 0]
    )
    await conn.query(
      `INSERT INTO class_ownership (class_id, teacher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, teacherId]
    )
    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }

  return { success: true, data: { id } }
})

app.delete('/api/v1/classes/:classId', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const { classId } = req.params
  const ownership = await query(
    'SELECT 1 FROM class_ownership WHERE class_id = $1 AND teacher_id = $2',
    [classId, teacherId]
  )
  if (ownership.rows.length === 0) {
    return reply.status(403).send({ success: false, error: '無權操作此班級' })
  }

  await query('DELETE FROM classes WHERE id = $1', [classId])
  return { success: true }
})

// --- Snapshots (sync) ---

app.get('/api/v1/snapshots/:classId', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const { classId } = req.params
  const ownership = await query(
    'SELECT 1 FROM class_ownership WHERE class_id = $1 AND teacher_id = $2',
    [classId, teacherId]
  )
  if (ownership.rows.length === 0) {
    return reply.status(403).send({ success: false, error: '無權存取此班級' })
  }

  const result = await query(
    'SELECT payload, version, updated_at FROM class_snapshots WHERE class_id = $1',
    [classId]
  )
  if (result.rows.length === 0) {
    return { success: true, data: null }
  }

  const row = result.rows[0]
  return {
    success: true,
    data: {
      payload: row.payload,
      version: row.version,
      updatedAt: row.updated_at
    }
  }
})

app.put('/api/v1/snapshots/:classId', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const { classId } = req.params
  const { payload, version } = req.body || {}

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return reply.status(400).send({ success: false, error: 'payload 格式無效' })
  }

  const ownership = await query(
    'SELECT 1 FROM class_ownership WHERE class_id = $1 AND teacher_id = $2',
    [classId, teacherId]
  )
  if (ownership.rows.length === 0) {
    return reply.status(403).send({ success: false, error: '無權操作此班級' })
  }

  const nextVersion = (version || 0) + 1
  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')

    // Atomic version check + upsert
    const upsertResult = await conn.query(
      `INSERT INTO class_snapshots (class_id, payload, version, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (class_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         version = EXCLUDED.version,
         updated_at = NOW()
       WHERE class_snapshots.version <= $4
       RETURNING version`,
      [classId, JSON.stringify(payload), nextVersion, version || 0]
    )

    if (upsertResult.rowCount === 0) {
      await conn.query('ROLLBACK')
      const current = await query('SELECT version FROM class_snapshots WHERE class_id = $1', [classId])
      return reply.status(409).send({
        success: false,
        error: '版本衝突：伺服器已有更新的資料',
        serverVersion: current.rows[0]?.version || 0
      })
    }

    // Update class meta in same transaction
    const studentCount = Array.isArray(payload.students) ? payload.students.length : 0
    await conn.query(
      'UPDATE classes SET student_count = $1, updated_at = NOW() WHERE id = $2',
      [studentCount, classId]
    )

    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }

  return { success: true, data: { version: nextVersion } }
})

app.get('/api/v1/snapshots/:classId/version', async (req, reply) => {
  if (!checkRateLimit(req.ip, 'api', RATE_MAX_GENERAL)) {
    return reply.status(429).send({ success: false, error: '請求過於頻繁' })
  }
  const teacherId = await authenticate(req, reply)
  if (!teacherId) return

  const { classId } = req.params
  const result = await query(
    'SELECT version, updated_at FROM class_snapshots WHERE class_id = $1',
    [classId]
  )
  if (result.rows.length === 0) {
    return { success: true, data: { version: 0, updatedAt: null } }
  }
  return {
    success: true,
    data: { version: result.rows[0].version, updatedAt: result.rows[0].updated_at }
  }
})

// --- Start ---

const port = parseInt(process.env.PORT || '3010')
const host = process.env.HOST || '0.0.0.0'

try {
  await app.listen({ port, host })
  console.log(`Purr Purr Town API listening on ${host}:${port}`)
  // Clean expired sessions every hour
  setInterval(() => cleanExpiredSessions().catch(e => app.log.error(e)), 3600_000)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
