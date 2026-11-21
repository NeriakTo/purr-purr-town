import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import { createRound, overdueEvent, setupCorrectionTask, taipeiDayOffset } from './correction-rounds.js'
import { submit } from './operations.js'

export const scheduler = { kind: 'scheduler', id: 'scheduler' }

const testNamespace = Buffer.from('2b66147fa22f4ad2bdf242cce941e40e', 'hex')

export function scheduledId(classId, date, namespace = testNamespace) {
  const bytes = createHash('sha1').update(namespace)
    .update(JSON.stringify([classId, 'correction_overdue', date])).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

export function overdueOperation(classId, date, opId = scheduledId(classId, date)) {
  return { op_id: opId, class_id: classId, type: 'schedule.correction_overdue', payload: { date } }
}

export function authorizeScheduler(client, classId) {
  return client.query(
    `INSERT INTO ppt.class_authorizations (class_id, actor_kind) VALUES ($1, 'scheduler')
     ON CONFLICT (class_id, actor_kind) DO NOTHING`, [classId],
  )
}

export async function scheduleOverdue(client, classId, date) {
  const receipt = await submit(client, overdueOperation(classId, date), scheduler)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

export function offsetDay(day, days) {
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function overdueFixture(client, options, correctionFields = {}) {
  const today = await taipeiDayOffset(client, 0)
  const task = await setupCorrectionTask(client, options)
  await authorizeScheduler(client, task.classId)
  const target = await createRound(client, task, { due_on: offsetDay(today, -10), ...correctionFields })
  return { today, target, classId: task.classId }
}

export async function overdueEffects(client, { classId, correctionId }) {
  const { rows } = await client.query(`
    SELECT * FROM ppt.effects
    WHERE class_id = $1 AND event = $2 AND subject_kind = 'correction' AND subject_key = $3
  `, [classId, overdueEvent, correctionId])
  return rows
}
