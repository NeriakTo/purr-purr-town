import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { convert } from './convert.js'
import { classA, classB } from './__fixtures__/classes.js'

const sql = readFileSync(new URL('./schema-v2.sql', import.meta.url), 'utf8')
const outputs = [convert(classA), convert(classB)]

function ddlIssues(definition, results) {
  const issues = []
  const tables = [...definition.matchAll(/CREATE TABLE migration_v2\.(\w+) \(([\s\S]*?)\n\);/g)]
  const names = tables.map(match => match[1])
  for (const result of results) {
    for (const name of Object.keys(result.rows)) {
      if (!names.includes(name)) issues.push(`${name}:missing_ddl`)
    }
  }
  for (const [, table, body] of tables) {
    const records = results.flatMap(result => result.rows[table] || [])
    if (!records.length) issues.push(`${table}:untested`)
    const columns = [...body.matchAll(/^ {2}(\w+) (text|jsonb|numeric|integer|boolean)\b(.*)$/gm)]
    const columnNames = columns.map(match => match[1])
    for (const row of records) {
      for (const key of Object.keys(row)) {
        if (!columnNames.includes(key)) issues.push(`${table}.${key}:missing_ddl`)
      }
      for (const [, key, type, constraints] of columns) {
        const label = `${table}.${key}`
        if (!Object.hasOwn(row, key)) {
          if (!constraints.includes('DEFAULT ')) issues.push(`${label}:missing_output`)
          continue
        }
        const value = row[key]
        if (value === undefined) issues.push(`${label}:undefined`)
        if (value === null) continue // JSON null 按匯入契約序列化；typed null 允許暫存。
        if (!typeMatches(type, value)) issues.push(`${label}:type`)
        if (!checkMatches(constraints, value)) issues.push(`${label}:check`)
      }
    }
  }
  return issues
}

function typeMatches(type, value) {
  if (type === 'jsonb') return true
  if (type === 'numeric') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isInteger(value)
  return typeof value === (type === 'text' ? 'string' : 'boolean')
}

function checkMatches(constraints, value) {
  const choices = constraints.match(/CHECK \(\w+ IN \((.*?)\)\)/)?.[1]
  if (choices) return [...choices.matchAll(/'([^']+)'/g)].some(match => match[1] === value)
  const literal = constraints.match(/CHECK \(\w+ = (true|false)\)/)?.[1]
  return literal === undefined || value === (literal === 'true')
}

it('R10 DDL 與每張表輸出雙向吻合，型別及 CHECK 皆相容', () => {
  expect(ddlIssues(sql, outputs)).toEqual([])
})

it('R10 反向檢查能抓出只出現在 DDL 的欄位，明列 DEFAULT 才可省略', () => {
  const extra = sql.replace('source_hash text NOT NULL,', 'source_hash text NOT NULL,\n  unexplained text,')
  expect(ddlIssues(extra, outputs)).toContain('migration_batches.unexplained:missing_output')
  expect(ddlIssues(extra.replace('unexplained text,', "unexplained text DEFAULT 'draft',"), outputs)).toEqual([])
})

it('R10 能抓出輸出少欄、多欄、型別錯誤及 CHECK 違反', () => {
  for (const [mutate, issue] of [
    [rows => { delete rows.students[0].name }, 'students.name:missing_output'],
    [rows => { rows.students[0].extra = true }, 'students.extra:missing_ddl'],
    [rows => { rows.students[0].group_key = 1 }, 'students.group_key:type'],
    [rows => { rows.students[0].enrollment_status = 'bad' }, 'students.enrollment_status:check'],
    [rows => { rows.transactions[0].legacy_semantics = false }, 'transactions.legacy_semantics:check'],
  ]) {
    const copy = structuredClone(outputs)
    mutate(copy[0].rows)
    expect(ddlIssues(sql, copy)).toContain(issue)
  }
})
