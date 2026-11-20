import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'

// 規格 01:398–449。E-13 的 PAIRING_INVALID 已移除。
const specificationCodes = new Set([
  'AUTH_REQUIRED', 'AUTH_EXPIRED', 'CLASS_FORBIDDEN', 'RATE_LIMITED', 'SERVER_BUSY',
  'UPSTREAM_UNREACHABLE', 'INTERNAL_ERROR', 'NOT_PROCESSED', 'BAD_ENVELOPE', 'ROUTE_NOT_ALLOWED',
  'INVALID_OP_ID', 'OP_ID_REUSED', 'LEGACY_WRITE_CLOSED', 'CALL_ID_REUSED', 'HELD_QUEUE_FULL', 'RELAY_FORBIDDEN',
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
