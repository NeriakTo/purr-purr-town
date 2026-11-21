import { randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'

export function saveAnnouncement(classId, fields = {}, version = { rev: 0 }) {
  return operation(classId, 'announcement.save', {
    announcement_id: randomUUID(), text: '測試公告', ...fields,
  }, version)
}

export function removeAnnouncement(classId, announcementId, version = { rev: 1 }) {
  return operation(classId, 'announcement.remove', { announcement_id: announcementId }, version)
}

export function saveSeating(classId, fields = {}, version = { rev: 0 }) {
  return operation(classId, 'seating.save', {
    rows: 6, cols: 8, view: 'teacher', seats: {}, objects: {}, custom_objects: [], ...fields,
  }, version)
}

export async function announcementRow(client, classId, announcementId) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.announcements WHERE class_id = $1 AND announcement_id = $2', [classId, announcementId],
  )
  return row
}

export async function seatingRow(client, classId) {
  const { rows: [row] } = await client.query('SELECT * FROM ppt.seating WHERE class_id = $1', [classId])
  return row
}
