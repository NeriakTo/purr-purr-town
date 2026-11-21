import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'

async function readTeacherName(pool, teacherId) {
  const { rows: [teacher] } = await readQuery(pool, 'SELECT id, name FROM public.teachers WHERE id = $1', [teacherId])
  if (!teacher) throw new RequestError('AUTH_REQUIRED')
  return teacher
}

async function deleteSession(pool, tokenHash) {
  const { rowCount } = await readQuery(pool, 'DELETE FROM ppt_web_state.sessions WHERE token_hash = $1', [tokenHash])
  if (!rowCount) throw new RequestError('AUTH_REQUIRED')
}

export function registerSessionRoutes(app, { pool, clock, authenticateTeacher }) {
  const route = { onRequest: authenticateTeacher }
  app.post('/api/v2/auth/session', route, async request => {
    const { actor, expiresAt } = request.teacherSession
    const teacher = await readTeacherName(pool, actor.id)
    return { server_time: clock().toISOString(), teacher, expires_at: new Date(expiresAt).toISOString() }
  })
  app.post('/api/v2/auth/logout', route, async request => {
    await deleteSession(pool, request.teacherSession.tokenHash)
    return { server_time: clock().toISOString() }
  })
}
