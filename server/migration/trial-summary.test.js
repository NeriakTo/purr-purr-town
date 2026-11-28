import { expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import source from './__fixtures__/trial-source.json'
import { TABLES } from './convert.js'
import * as reconciliation from './reconcile.js'
import { summarizeTrial } from './trial-summary.js'

const scriptPath = fileURLToPath(new URL('./trial-summary.js', import.meta.url))
const sourcePath = fileURLToPath(new URL('./__fixtures__/trial-source.json', import.meta.url))
const invalidJsonPath = fileURLToPath(new URL('./__fixtures__/classes.js', import.meta.url))

const decisions = {
  cutoverDate: '2026-11-15',
  openingAdjustment: true,
  semesterRule: 'month',
  orphanTaskStatus: 'snapshot_only',
}

function expectKeys(object, keys) {
  expect(Object.keys(object).sort()).toEqual([...keys].sort())
}

function expectNoFixtureText(summary) {
  const serialized = JSON.stringify(summary)
  const fixtureText = [
    source.className,
    ...source.data.students.map(student => student.name),
    source.data.students[0].bank.transactions[0].reason,
    source.data.logs[0].tasks[0].title,
  ]
  for (const text of fixtureText) expect(serialized).not.toContain(text)
}

it('試轉摘要每層只輸出白名單欄位、統計及來源路徑', () => {
  const summary = summarizeTrial(source, decisions)
  expectKeys(summary, [
    'converter_version', 'batch_id', 'decisions', 'row_counts', 'error_counts', 'notice_counts',
    'orphan_task_statuses', 'duplicate_seat_numbers', 'seat_number_coverage', 'opening_adjustments',
    'convert_ready', 'reconcile',
  ])
  expectKeys(summary.decisions, Object.keys(decisions))
  expectKeys(summary.row_counts, TABLES)
  expectKeys(summary.error_counts, [])
  expectKeys(summary.notice_counts, ['ORPHAN_TASK_STATUS', 'TOTAL_EARNED_DRIFT', 'UNKNOWN_ASSIGNMENT_LIST'])
  expect(summary.notice_counts).toEqual({ ORPHAN_TASK_STATUS: 1, TOTAL_EARNED_DRIFT: 1, UNKNOWN_ASSIGNMENT_LIST: 1 })
  expect(summary.orphan_task_statuses).toEqual([
    { day: '2026-11-01', task_key: 'fixture-deleted-task', count: 1, by_status: { missing: 1 } },
  ])
  expect(summary.duplicate_seat_numbers).toEqual([
    { seat_number: '7', student_paths: ['/data/students/0', '/data/students/1'] },
  ])
  expect(summary.seat_number_coverage).toEqual({ with_number: 2, seat_number_only: 1, neither: 1 })
  expect(summary.opening_adjustments).toEqual([{ path: '/data/students/0/bank', amount: 3, earned_delta: 5 }])
  expect(summary.converter_version).toBe('v2-1A-r5')
  expect(summary.batch_id).toMatch(/^[a-f0-9]{64}$/)
  expect(summary.convert_ready).toBe(true)
  expect(summary.reconcile).toEqual({
    matches: true, difference_count: 0, difference_paths: [], period_skipped_count: 0, ready_for_import: true,
  })
  expectNoFixtureText(summary)
})

it('孤兒提示按日期和作業鍵排序，同組累計各狀態', () => {
  const grouped = structuredClone(source)
  grouped.data.logs[0].status['fixture-s2'] = { 'fixture-deleted-task': true }
  grouped.data.logs[0].status['fixture-s1'].aaa = { name: source.data.students[0].name }
  grouped.data.logs.push({ date: '2026-10-31', status: { 'fixture-s3': { zzz: false } } })
  const summary = summarizeTrial(grouped, decisions)
  expect(summary.orphan_task_statuses).toEqual([
    { day: '2026-10-31', task_key: 'zzz', count: 1, by_status: { pending: 1 } },
    { day: '2026-11-01', task_key: 'aaa', count: 1, by_status: { unknown: 1 } },
    { day: '2026-11-01', task_key: 'fixture-deleted-task', count: 2, by_status: { missing: 1, on_time: 1 } },
  ])
  expectNoFixtureText(summary)
})

it('省略孤兒決定時摘要只計錯誤碼，並統計後備與缺漏座號', () => {
  const withoutOrphanDecision = {
    cutoverDate: decisions.cutoverDate,
    openingAdjustment: true,
    semesterRule: 'month',
  }
  const summary = summarizeTrial(source, withoutOrphanDecision)
  expect(summary.decisions).toEqual(withoutOrphanDecision)
  expect(summary.error_counts).toEqual({ ORPHAN_TASK: 1 })
  expect(summary.notice_counts).toEqual({ TOTAL_EARNED_DRIFT: 1, UNKNOWN_ASSIGNMENT_LIST: 1 })
  expect(summary.orphan_task_statuses).toEqual([])
  expect(summary.convert_ready).toBe(false)
  expect(summary.reconcile.ready_for_import).toBe(false)
  expectNoFixtureText(summary)
})

it('差異只輸出前 50 筆路徑、略過數及總筆數', () => {
  const differences = Array.from({ length: 53 }, (_, index) => ({
    path: `students/data/students/${index}/name`,
    expected: source.data.students[0].name,
    actual: source.data.students[1].name,
  }))
  const mock = vi.spyOn(reconciliation, 'reconcile').mockReturnValueOnce({
    differences, matches: false, ready_for_import: false,
    period_skipped: [{ path: '/data/students/0', reason: source.data.students[0].bank.transactions[0].reason }],
  })
  try {
    const summary = summarizeTrial(source, decisions)
    expect(summary.reconcile).toEqual({
      matches: false, difference_count: 53, difference_paths: differences.slice(0, 50).map(diff => diff.path),
      period_skipped_count: 1, ready_for_import: false,
    })
    expectNoFixtureText(summary)
  } finally {
    mock.mockRestore()
  }
})

it('額外決定及異型日期的內嵌欄位不會流入摘要', () => {
  const malformed = structuredClone(source)
  malformed.data.logs[0].date = { name: source.data.students[0].name }
  const summary = summarizeTrial(malformed, { ...decisions, raw: source.data.students[0] })
  expect(summary.decisions).toEqual(decisions)
  expect(summary.orphan_task_statuses).toEqual([
    { day: null, task_key: 'fixture-deleted-task', count: 1, by_status: { missing: 1 } },
  ])
  expectNoFixtureText(summary)
})

function runCli(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
}

it('命令列成功時只在標準輸出印可解析的摘要', () => {
  const result = runCli(sourcePath, '--decisions', JSON.stringify(decisions))
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual(summarizeTrial(source, decisions))
  expectNoFixtureText(JSON.parse(result.stdout))
})

it.each([
  ['缺少決定', [sourcePath], /用法：/],
  ['檔案讀不到', [`${sourcePath}.missing`, '--decisions', '{}'], /無法讀取來源檔/],
  ['來源 JSON 有誤', [invalidJsonPath, '--decisions', '{}'], /來源檔不是有效的 JSON/],
  ['決定 JSON 有誤', [sourcePath, '--decisions', '{ fake-input'], /--decisions 不是有效的 JSON/],
  ['孤兒決定不合法', [sourcePath, '--decisions', '{"orphanTaskStatus":"fake-input"}'], /orphanTaskStatus 必須/],
  ['切換日不合法', [sourcePath, '--decisions', '{"cutoverDate":"fake-input"}'], /cutoverDate 必須/],
])('命令列遇到%s只印原因並回傳 2', (_case, args, reason) => {
  const result = runCli(...args)
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr.trim().split('\n')).toHaveLength(1)
  expect(result.stderr).toMatch(reason)
  expect(result.stderr).not.toMatch(/fake-input|假班甲/)
})
