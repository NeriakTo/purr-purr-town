import bcrypt from 'bcrypt'
import { randomBytes, createHash } from 'crypto'
import { query } from './db.js'

const SALT_ROUNDS = 10

export async function hashPasscode(passcode) {
  return bcrypt.hash(passcode, SALT_ROUNDS)
}

export async function verifyPasscode(passcode, hash) {
  return bcrypt.compare(passcode, hash)
}

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

// 憑證有效期：90 天閒置滑動。每次驗證成功時，若剩餘 < 30 天才延展，
// 避免每次存檔都 UPDATE sessions。老師持續使用即不會被登出；
// 真正閒置逾 90 天才過期，過期者不可復活（須重新登入）。
const SESSION_TTL = "90 days"
const SLIDE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

export async function createSession(teacherId) {
  const raw = randomBytes(32).toString('hex')
  const tokenHash = hashToken(raw)
  await query(
    `INSERT INTO sessions (token_hash, teacher_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${SESSION_TTL}')`,
    [tokenHash, teacherId]
  )
  return raw
}

export async function validateToken(raw) {
  if (!raw) return null
  const tokenHash = hashToken(raw)
  const result = await query(
    'SELECT teacher_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash]
  )
  if (result.rows.length === 0) return null

  // 滑動延展：剩餘不足門檻時把到期日推回滿 TTL。
  const expiresAt = new Date(result.rows[0].expires_at)
  const remainingMs = expiresAt.getTime() - Date.now()
  if (remainingMs < SLIDE_THRESHOLD_MS) {
    // 加 expires_at > NOW() 條件：只延展仍有效的憑證，避免與 SELECT 之間的時間差
    // 讓一個剛好過期的憑證被復活。
    await query(
      `UPDATE sessions SET expires_at = NOW() + INTERVAL '${SESSION_TTL}' WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    )
  }
  return result.rows[0].teacher_id
}

export async function destroySession(raw) {
  if (!raw) return
  const tokenHash = hashToken(raw)
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
}

export async function cleanExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at < NOW()')
}
