import { expect, it } from 'vitest'
import { convert } from './convert.js'
import { legacyEarned, reconcile } from './reconcile.js'
import { validateSource } from './source-validation.js'
import { classA } from './__fixtures__/classes.js'

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

const snapshotOnly = { ...formal, orphanTaskStatus: 'snapshot_only' }
const orphanPath = '/data/logs/0/status/s1/deleted~1~0'
const orphanNotice = {
  code: 'ORPHAN_TASK_STATUS',
  path: orphanPath,
  value: { day: '2026-09-01T08:00:00+08:00', legacy_student_id: 's1', task_key: 'deleted/~', status: 'unknown' },
}

function sourceWithOrphan() {
  return sourceWith([{ date: orphanNotice.value.day, status: { s1: { 'deleted/~': 'invalid' } } }])
}

function sourceWithMixedStatuses() {
  const source = sourceWithOrphan()
  const [first] = source.data.logs
  first.tasks = [{ id: 1 }]
  Object.assign(first.status.s1, { 1: true, 2: 'late' })
  source.data.logs.push({ date: '2026-09-02', tasks: [{ id: 2 }] })
  return source
}

it.each([
  [formal, ['ORPHAN_TASK', 'UNKNOWN_STATUS', 'ORPHAN_TASK'], ['UNKNOWN_ASSIGNMENT_LIST', 'UNKNOWN_ASSIGNMENT_LIST'], 3],
  [snapshotOnly, ['ORPHAN_TASK'], ['UNKNOWN_ASSIGNMENT_LIST', 'ORPHAN_TASK_STATUS', 'UNKNOWN_ASSIGNMENT_LIST'], 2],
])('轉換依決定保留舊列或逐筆提示，另一天的作業仍列錯誤 (%s)', (decisions, errorCodes, noticeCodes, rowCount) => {
  const source = sourceWithMixedStatuses()
  const converted = convert(source, { decisions })
  expect(converted.errors.map(error => error.code)).toEqual(errorCodes)
  expect(converted.report.notices.map(notice => notice.code)).toEqual(noticeCodes)
  expect(converted.rows.submissions).toHaveLength(rowCount)
  expect(converted.rows.submissions.find(row => row.legacy_id === '1').task_id).toBe(converted.rows.tasks[0].id)
  const otherDay = converted.rows.submissions.find(row => row.legacy_id === '2')
  expect(otherDay).toMatchObject({ task_id: null, status: 'late', present: true })
  expect(converted.errors).toContainEqual({ code: 'ORPHAN_TASK', path: otherDay.source_path, value: '2' })
  expect(converted.rows.migration_batches[0].decisions).toEqual(decisions)
  expect(converted.rows.logs[0].raw).toEqual(source.data.logs[0])
  expect(converted.rows.migration_sources[0].raw).toEqual(source)
  const audit = reconcile(source, converted)
  expect(audit.differences).toEqual([])
  expect(audit.ready_for_import).toBe(false)
})

it('來源檢查用完整日期原值與逸出路徑逐筆提示孤兒狀態', () => {
  const source = sourceWithMixedStatuses()
  const notices = []
  const errors = validateSource(source, legacyEarned, { decisions: snapshotOnly, notices })
  expect(errors).toEqual([{ code: 'ORPHAN_TASK', path: '/data/logs/0/status/s1/2', value: '2' }])
  expect(notices).toEqual([
    { code: 'UNKNOWN_ASSIGNMENT_LIST', path: '/data/logs/0/tasks/0', value: null },
    orphanNotice,
    { code: 'UNKNOWN_ASSIGNMENT_LIST', path: '/data/logs/1/tasks/0', value: null },
  ])
})

it('只有孤兒狀態時可正式匯入，以快照與提示保留且不建對照', () => {
  const source = sourceWithOrphan()
  const converted = convert(source, { decisions: snapshotOnly })
  expect(converted.errors).toEqual([])
  expect(converted.report.ready_for_import).toBe(true)
  expect(converted.report.notices).toEqual([orphanNotice])
  expect(converted.rows.submissions).toEqual([])
  expect(converted.rows.legacy_ids.some(row => row.source_path === orphanPath)).toBe(false)
  const audit = reconcile(source, converted)
  expect(audit.ready_for_import).toBe(true)
  expect(audit.differences).toEqual([])
  expect(audit.notices).toEqual([orphanNotice])
  expect(reconcile(source, convert(source, { decisions: { orphanTaskStatus: 'snapshot_only' } })).ready_for_import).toBe(false)
})

it('對帳獨立查出補回的孤兒繳交列與被刪掉的提示', () => {
  const source = sourceWithOrphan()
  const previous = convert(source, { decisions: formal })
  const clean = convert(source, { decisions: snapshotOnly })
  expect(reconcile(source, clean).differences).toEqual([])
  const withRow = structuredClone(clean)
  const batch_id = clean.rows.migration_batches[0].id
  withRow.rows.submissions.push({ ...previous.rows.submissions[0], batch_id })
  const mapping = previous.rows.legacy_ids.find(row => row.table_name === 'submissions')
  withRow.rows.legacy_ids.push({ ...mapping, batch_id })
  expect(reconcile(source, withRow).differences.map(diff => diff.path)).toEqual(['submissions/source_paths'])

  const withoutNotice = structuredClone(clean)
  withoutNotice.report.notices = []
  expect(reconcile(source, withoutNotice).differences.map(diff => diff.path)).toEqual(['report/notices'])
})

it('假班甲的 ghost/gone 只提示作業狀態，仍回報找不到學生', () => {
  const converted = convert(classA, { decisions: snapshotOnly })
  expect(converted.errors.map(error => error.code)).not.toContain('ORPHAN_TASK')
  expect(converted.errors).toContainEqual({
    code: 'ORPHAN_STUDENT', path: '/data/logs/0/status/ghost', value: 'ghost',
  })
  expect(converted.report.notices).toContainEqual({
    code: 'ORPHAN_TASK_STATUS',
    path: '/data/logs/0/status/ghost/gone',
    value: { day: '2026-09-01', legacy_student_id: 'ghost', task_key: 'gone', status: 'missing' },
  })
  expect(reconcile(classA, converted).differences).toEqual([])
})

it('忽略空作業編號，同一天數字與字串編號重複仍視為多義', () => {
  const source = sourceWith([{
    date: '2026-09-01',
    tasks: [{ id: 0 }, { id: '0' }, { id: null }, {}],
    status: { s1: { 0: true, null: false, undefined: true } },
  }])
  const converted = convert(source, { decisions: snapshotOnly })
  expect(converted.errors.map(error => error.code)).toEqual([
    'DUPLICATE_LEGACY_ID', 'MISSING_LEGACY_ID', 'MISSING_LEGACY_ID', 'AMBIGUOUS_REFERENCE',
  ])
  expect(converted.rows.submissions).toHaveLength(1)
  expect(converted.rows.submissions[0]).toMatchObject({ task_id: null, legacy_id: '0' })
  expect(converted.report.notices.filter(notice => notice.code === 'ORPHAN_TASK_STATUS').map(notice => notice.value.status))
    .toEqual(['pending', 'on_time'])
  expect(reconcile(source, converted).differences).toEqual([])
})
