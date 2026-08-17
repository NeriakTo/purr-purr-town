import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createHash } from 'crypto'
import pool, { query } from './db.js'
import { hashPasscode, verifyPasscode, createSession, validateToken, destroySession, cleanExpiredSessions } from './auth.js'

// session 端點要用 token 的 sha256 去查 sessions 表；與 auth.js 的 hashToken 一致。
function hashRaw(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://neriakto.github.io').split(',')
const BODY_LIMIT = 5 * 1024 * 1024

// --- Rate limiting (in-memory, per IP) ---

const RATE_WINDOW_MS = 60_000
const RATE_MAX_AUTH = 10
const RATE_MAX_GENERAL = 60

function makeRateLimiter() {
  const rateLimits = new Map()

  function check(ip, bucket, max) {
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

  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimits) {
      if (now - entry.windowStart > RATE_WINDOW_MS * 2) {
        rateLimits.delete(key)
      }
    }
  }, RATE_WINDOW_MS)
  timer.unref?.()

  return check
}

/**
 * 建立 Fastify app（不呼叫 listen）。分離出來讓測試能以 app.inject 驅動，
 * 並在測試中以 vi.mock 替換 db / auth 依賴。
 */
export async function buildApp({ logger = false } = {}) {
  const app = Fastify({ logger, bodyLimit: BODY_LIMIT, trustProxy: true })
  const checkRateLimit = makeRateLimiter()

  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  app.setErrorHandler((err, req, reply) => {
    app.log.error(err)
    reply.status(500).send({ success: false, error: '伺服器錯誤' })
  })

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

  app.post('/api/v1/auth/logout', async (req) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return { success: true }
    }
    const raw = auth.slice(7)
    await destroySession(raw)
    return { success: true }
  })

  // 目前登入狀態：前端啟動時驗證憑證是否仍有效，取代「只看本機有沒有存 token」的假連線判定。
  app.get('/api/v1/auth/session', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: '未授權' })
    }
    const raw = auth.slice(7)
    const teacherId = await validateToken(raw)
    if (!teacherId) {
      return reply.status(401).send({ success: false, error: 'Token 無效或已過期' })
    }
    const result = await query(
      'SELECT t.name, s.expires_at FROM sessions s JOIN teachers t ON t.id = s.teacher_id WHERE s.token_hash = $1',
      [hashRaw(raw)]
    )
    const row = result.rows[0]
    return {
      success: true,
      data: { teacherId, name: row?.name || '', expiresAt: row?.expires_at || null },
    }
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

  // 擁有權守衛：呼叫端必須是該班級的擁有者，否則回 403。回傳 true 表示放行。
  async function requireOwnership(classId, teacherId, reply) {
    const ownership = await query(
      'SELECT 1 FROM class_ownership WHERE class_id = $1 AND teacher_id = $2',
      [classId, teacherId]
    )
    if (ownership.rows.length === 0) {
      reply.status(403).send({ success: false, error: '無權存取此班級' })
      return false
    }
    return true
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

      // 授權守衛（防奪取，且避免 TOCTOU 競態）：
      // 用原子式 INSERT ... ON CONFLICT DO NOTHING RETURNING 判定「是不是我這次建立的」。
      // 只有真正插入成功（RETURNING 回一列）的那一個交易才是建立者，才加擁有者。
      // 兩個交易同時搶建同一新 id 時，只有一個 INSERT 會成功，另一個 rowCount=0，
      // 落到下面的擁有權檢查→非擁有者→409。舊版先 SELECT 再 UPSERT 有 TOCTOU 破口。
      const created = await conn.query(
        `INSERT INTO classes (id, year, name, teacher, alias, status, student_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, year || '', name, teacher || '', alias || '', status || 'active', studentCount || 0]
      )

      if (created.rowCount === 1) {
        // 這次才建立的班級——本人即擁有者
        await conn.query(
          `INSERT INTO class_ownership (class_id, teacher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, teacherId]
        )
        await conn.query('COMMIT')
        return { success: true, data: { id } }
      }

      // 班級已存在——必須是既有擁有者才能改寫其中繼資料
      const owns = await conn.query(
        'SELECT 1 FROM class_ownership WHERE class_id = $1 AND teacher_id = $2',
        [id, teacherId]
      )
      if (owns.rows.length === 0) {
        await conn.query('ROLLBACK')
        return reply.status(409).send({ success: false, error: '班級代號已被使用' })
      }

      await conn.query(
        `UPDATE classes SET
           year = $2, name = $3, teacher = $4, alias = $5, status = $6, student_count = $7,
           updated_at = NOW()
         WHERE id = $1`,
        [id, year || '', name, teacher || '', alias || '', status || 'active', studentCount || 0]
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
    if (!(await requireOwnership(classId, teacherId, reply))) return

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
    if (!(await requireOwnership(classId, teacherId, reply))) return

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
      data: { payload: row.payload, version: row.version, updatedAt: row.updated_at },
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

    if (!(await requireOwnership(classId, teacherId, reply))) return

    const nextVersion = (version || 0) + 1
    const conn = await pool.connect()
    try {
      await conn.query('BEGIN')

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
          serverVersion: current.rows[0]?.version || 0,
        })
      }

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
    // 授權守衛：舊版此端點漏驗擁有權，任何帳號可查任意班級的版本與更新時間。
    if (!(await requireOwnership(classId, teacherId, reply))) return

    const result = await query(
      'SELECT version, updated_at FROM class_snapshots WHERE class_id = $1',
      [classId]
    )
    if (result.rows.length === 0) {
      return { success: true, data: { version: 0, updatedAt: null } }
    }
    return {
      success: true,
      data: { version: result.rows[0].version, updatedAt: result.rows[0].updated_at },
    }
  })

  return app
}

export { cleanExpiredSessions }
