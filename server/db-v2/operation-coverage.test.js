import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'

const root = new URL('./', import.meta.url)
const contract = new URL('../../docs/revamp/operation-contract/02-操作規格-v0.4-操作與點數.md', root)

function readOperations(document) {
  const rows = document.split('\n').filter(line => /^\| OP-\d{2} \| `/.test(line))
  expect(rows).toHaveLength(53)
  const operations = rows.map(line => {
    const columns = line.split('|').slice(1, -1).map(column => column.trim())
    expect(columns).toHaveLength(9)
    const [id, typeColumn, who, behavior, , , , undo] = columns
    const [, type] = typeColumn.match(/^`([a-z_.]+)`/)
    return { id, type, who, behavior, undo, removed: typeColumn.includes('已移除') }
  })
  expect(operations.filter(row => row.removed).map(row => row.id)).toEqual(['OP-48', 'OP-49'])
  return operations.filter(row => !row.removed)
}

function expectedDefinition({ id, type, who, behavior }) {
  const roleMap = { T: 'teacher', A: 'agent', S: 'scheduler', 系統: 'system' }
  const roles = who.split('、').map(role => roleMap[role.split('（')[0]]).sort()
  expect(roles).not.toContain(undefined)
  const expectMode = { 加: 'forbidden', 設: 'required', '設（例外）': 'per_item' }[behavior]
  expect(expectMode).toBeDefined()
  if (expectMode === 'per_item') expect(id).toBe('OP-08')
  return { type, roles, expectMode }
}

function parseDefinitions(sql) {
  const [, valueList] = sql.match(/FROM \(VALUES([\s\S]*?)\) AS definition\(type, roles, expect_mode\)/)
  return [...valueList.matchAll(/\('"([^"]+)"'::jsonb, ARRAY\[([^\]]+)\], '([^']+)'\)/g)]
    .map(([, type, roleList, expectMode]) => ({ type, roles: quotedValues(roleList).sort(), expectMode }))
}

function quotedValues(text) {
  return [...text.matchAll(/'([^']+)'/g)].map(([, value]) => value)
}

function caseTypes(sql, expression) {
  const start = sql.indexOf(expression)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = sql.slice(start).split('END CASE;')[0]
  return [...body.matchAll(/\bWHEN\s+((?:'[^']+'(?:\s*,\s*)?)+)\s+THEN/g)]
    .flatMap(([, values]) => quotedValues(values))
}

test('51 種操作與規格的角色、版本條件、分派及撤銷白名單逐項一致', async () => {
  const [document, definitions, submit, undo] = await Promise.all([
    readFile(contract, 'utf8'),
    readFile(new URL('sql/045-operation-input.sql', root), 'utf8'),
    readFile(new URL('sql/090-submit.sql', root), 'utf8'),
    readFile(new URL('sql/340-undo-operation.sql', root), 'utf8'),
  ])
  const operations = readOperations(document)
  expect(operations).toHaveLength(51)
  const byType = (left, right) => left.type.localeCompare(right.type)
  expect(parseDefinitions(definitions).sort(byType)).toEqual(operations.map(expectedDefinition).sort(byType))
  const types = operations.map(({ type }) => type).sort()
  const expressions = ['check_operation_input_and_target', 'apply_operation']
  for (const name of expressions) {
    const body = submit.split('CREATE FUNCTION ppt.' + name + '(')[1]
    expect(caseTypes(body, "CASE p_op->>'type'").sort()).toEqual(types)
  }
  const undoable = operations.filter(({ id, undo: cell }) => id === 'OP-16' || cell.startsWith('可'))
    .map(({ type }) => type).sort()
  expect(undoable).toHaveLength(14)
  expect(caseTypes(undo, 'CASE p_target.type').sort()).toEqual(undoable)
})

test('03:376 對照表涵蓋建班和規格的十三種跨班查找，皆指向現有驗收', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8')
  const section = readme.split(/^## 03:376 跨班驗收\s*$/m)[1]?.split(/^## /m)[0]
  expect(section).toBeDefined()
  const matches = [...section.matchAll(/^\| (OP-\d{2}) \| `([^`]+\.test\.js)` \| ([^|]+) \|$/gm)]
  const expected = ['01', '16', '17', '19', '20', '21', '22', '23', '26', '27', '32', '50', '51', '53']
    .map(number => 'OP-' + number)
  expect([...new Set(matches.map(([, id]) => id))].sort()).toEqual(expected)
  await Promise.all(matches.map(async ([, , file, title]) => {
    const script = await readFile(new URL(file, root), 'utf8')
    expect(script).toContain("'" + title.trim() + "'")
  }))
})

test('03:385 與 03:414 每個資料庫測試套件皆註冊共用的收尾檢查', async () => {
  const files = (await readdir(root, { recursive: true })).filter(name => /\.test\.[jt]sx?$/.test(name))
  for (const file of files) {
    const source = await readFile(new URL(file, root), 'utf8')
    const suites = [...source.matchAll(/\bdescribeDatabase\s*\(/g)]
    if (!suites.length) continue
    expect([...source.matchAll(/\buseTestDatabase\s*\(/g)], file).toHaveLength(suites.length)
  }
})
