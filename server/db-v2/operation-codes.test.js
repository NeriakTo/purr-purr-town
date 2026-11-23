import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { readResultCodes } from './test-support/operation-specification.js'

// 規格 01:399–454。E-13 的 PAIRING_INVALID 已移除。E-46、E-47 是網站請求層級的碼，不在資料庫列舉。
const specificationCodes = new Set([
  'AUTH_REQUIRED', 'AUTH_EXPIRED', 'CLASS_FORBIDDEN', 'RATE_LIMITED', 'SERVER_BUSY',
  'UPSTREAM_UNREACHABLE', 'INTERNAL_ERROR', 'NOT_PROCESSED', 'BAD_ENVELOPE', 'ROUTE_NOT_ALLOWED',
  'INVALID_OP_ID', 'OP_ID_REUSED', 'LEGACY_WRITE_CLOSED', 'CALL_ID_REUSED', 'HELD_QUEUE_FULL', 'RELAY_FORBIDDEN',
  'LOGIN_FAILED', 'ORIGIN_FORBIDDEN',
  'OK', 'HELD_FOR_TEACHER', 'OP_CANCELLED', 'UNKNOWN_OP_TYPE', 'INVALID_PAYLOAD', 'FORBIDDEN_ROLE',
  'SCOPE_FORBIDDEN', 'NOT_FOUND', 'ID_CONFLICT', 'STALE_STATE', 'INVALID_TRANSITION', 'ENTITY_INACTIVE',
  'CLASS_ARCHIVED', 'INSUFFICIENT_BALANCE', 'OUT_OF_STOCK', 'PRICE_CHANGED', 'ITEM_ALREADY_USED',
  'RULE_VERSION_STALE', 'TX_NOT_REVERSIBLE', 'TX_ALREADY_REVERSED', 'NOT_UNDOABLE', 'ALREADY_UNDONE',
  'UNDO_CONFLICT', 'CONFIRMATION_NOT_PENDING', 'CONFIRMATION_REJECTED', 'COMMENT_LOCKED',
  'LEGACY_EFFECT_UNRESOLVED', 'HELD_OP_OUTDATED',
])

test('回應碼只在一處定義且全部列在規格表', async () => {
  const directory = new URL('./sql/', import.meta.url)
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()
  const definitions = []
  for (const name of files) {
    const sql = await readFile(new URL(name, directory), 'utf8')
    if (/\b(?:CREATE|ALTER)\s+TYPE\s+ppt\.operation_code\b/i.test(sql)) definitions.push({ name, sql })
  }
  expect(definitions.map(({ name }) => name)).toEqual(['020-operations.sql'])
  const enumBody = definitions[0].sql.match(/CREATE TYPE ppt\.operation_code AS ENUM\s*\(([^)]+)\)/)
  expect(enumBody).not.toBeNull()
  const codes = [...enumBody[1].matchAll(/'([^']+)'/g)].map(([, code]) => code)
  expect(codes).toContain('OK')
  expect(codes.filter(code => !specificationCodes.has(code))).toEqual([])
})

test('規格第 5 節的 46 個有效碼與資料庫的 34 個碼逐項一致', async () => {
  const { retry, final } = await readResultCodes()
  const rows = [...retry, ...final]
  expect(rows).toHaveLength(47)
  expect(rows.filter(row => row.removed).map(row => row.id)).toEqual(['E-13'])
  const active = rows.filter(row => !row.removed).map(row => row.code)
  expect(active).toHaveLength(46)
  expect(active.sort()).toEqual([...specificationCodes].sort())
  const external = new Set([
    'AUTH_REQUIRED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'SERVER_BUSY', 'UPSTREAM_UNREACHABLE',
    'INTERNAL_ERROR', 'NOT_PROCESSED', 'ROUTE_NOT_ALLOWED', 'LEGACY_WRITE_CLOSED', 'RELAY_FORBIDDEN',
    'LOGIN_FAILED', 'ORIGIN_FORBIDDEN',
  ])
  const sql = await readFile(new URL('./sql/020-operations.sql', import.meta.url), 'utf8')
  const [, body] = sql.match(/CREATE TYPE ppt\.operation_code AS ENUM\s*\(([^)]+)\)/)
  const databaseCodes = [...body.matchAll(/'([A-Z_]+)'/g)].map(([, code]) => code)
  expect(databaseCodes).toHaveLength(34)
  expect(databaseCodes.sort()).toEqual(active.filter(code => !external.has(code)))
})
