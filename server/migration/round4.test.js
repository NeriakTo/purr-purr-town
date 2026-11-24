import { expect, it } from 'vitest'
import { convert } from './convert.js'
import { legacyEarned, reconcile } from './reconcile.js'
import { validateSource } from './source-validation.js'

const formal = { cutoverDate: '2026-11-15', openingAdjustment: true, semesterRule: 'month' }

function sourceWith(logs = []) {
  return {
    classId: 'round4',
    data: {
      classId: 'round4',
      updatedAt: '2026-11-15',
      students: [{ id: 's1' }],
      logs,
    },
  }
}

it.each(['discard', null, undefined])('拒絕明傳的非法孤兒狀態決定 %s', orphanTaskStatus => {
  const source = sourceWith()
  const decisions = { ...formal, orphanTaskStatus }
  expect(() => convert(source, { decisions })).toThrow(/orphanTaskStatus/)
  expect(() => validateSource(source, legacyEarned, { decisions })).toThrow(/orphanTaskStatus/)

  const converted = convert(source, { decisions: formal })
  converted.rows.migration_batches[0].decisions = decisions
  expect(reconcile(source, converted).differences).toContainEqual({
    path: 'migration_batches/decisions/input',
    expected: '有效的轉換決定',
    actual: "orphanTaskStatus 必須是 'snapshot_only'",
  })
})
