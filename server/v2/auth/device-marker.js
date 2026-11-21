import { randomBytes } from 'node:crypto'
import { readQuery } from '../db.js'
import { hashSessionToken } from './session.js'

export async function readDeviceMarker(pool, marker, teacher) {
  if (!teacher || typeof marker !== 'string' || !/^[0-9a-f]{64}$/.test(marker) || marker.length !== 64) return
  const { rowCount } = await readQuery(pool, `
    SELECT 1 FROM ppt_web_state.device_markers WHERE marker_hash = $1 AND teacher_id = $2
  `, [hashSessionToken(marker), teacher.id])
  if (rowCount === 1) return marker
}

export async function createDeviceMarker(client, teacherId, now) {
  const marker = randomBytes(32).toString('hex')
  await client.query(`
    INSERT INTO ppt_web_state.device_markers (marker_hash, teacher_id, created_at)
    VALUES ($1, $2, $3)
  `, [hashSessionToken(marker), teacherId, now])
  return marker
}
