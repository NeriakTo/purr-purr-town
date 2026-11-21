import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { uuidV5 } from '../db-v2/test-support/batch-uuid.js'
import { commentApplyId, correctionOverdueId } from './jobs/operation-ids.js'
import { openWebTestDatabase } from './test-support/database.js'

const namespace = '7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8'
const date = '2026-11-15'

test('排程 UUID v5 固定向量包含 UUID 與 64 字元舊班級編號', () => {
  expect(correctionOverdueId('3f9c2a8e-5b71-4d2e-9a46-0c8b1e7d5f23', date))
    .toBe('d178bebf-e990-597c-8e89-2f66651d1af0')
  expect(correctionOverdueId('0123456789abcdef'.repeat(4), date))
    .toBe('069854fe-90c1-5d55-9e40-e06c11fb81e8')
})

test('評語套用 UUID v5 固定向量', () => {
  expect(commentApplyId('8b2d6f1a-4c3e-4f7a-b9d1-2e5c7a9f0b64'))
    .toBe('88c419b2-4367-5961-956a-ee0325d471bc')
})

test.skipIf(!process.env.PPT_TEST_DATABASE_URL)('二十組排程與評語編號等於資料庫與既有 UUID v5 測試算法', async () => {
  const db = await openWebTestDatabase()
  try {
    for (let day = 1; day <= 20; day++) {
      const classId = randomUUID()
      const requestId = randomUUID()
      const scheduleDate = '2026-11-' + String(day).padStart(2, '0')
      const { rows: [expected] } = await db.client.query(`
        SELECT ppt.uuid_v5(ppt.operation_uuid_namespace(), 'schedule.correction_overdue:' || $1 || ':' || $2) AS schedule,
               ppt.comment_apply_op_id($3) AS comment
      `, [classId, scheduleDate, requestId])
      expect(correctionOverdueId(classId, scheduleDate)).toBe(expected.schedule)
      expect(correctionOverdueId(classId, scheduleDate))
        .toBe(uuidV5(namespace, 'schedule.correction_overdue:' + classId + ':' + scheduleDate))
      expect(commentApplyId(requestId)).toBe(expected.comment)
      expect(commentApplyId(requestId)).toBe(uuidV5(namespace, 'comment.apply_generated:' + requestId))
    }
  } finally {
    await db.close()
  }
}, 15000)
