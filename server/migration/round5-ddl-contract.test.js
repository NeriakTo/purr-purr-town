import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const sql = readFileSync(new URL('./schema-v2.sql', import.meta.url), 'utf8')

it('歷史效果 DDL 涵蓋共同欄位、外鍵、型別與可空性', () => {
  const body = sql.match(/CREATE TABLE migration_v2\.legacy_effects \(([\s\S]*?)\n\);/)?.[1]
  expect(body).toBeDefined()
  const columns = Object.fromEntries([...body.matchAll(/^ {2}(\w+) (text|numeric|jsonb)\b(.*)$/gm)]
    .map(([, name, type, constraints]) => [name, [type, /NOT NULL|PRIMARY KEY/.test(constraints)]]))
  expect(columns).toEqual({
    id: ['text', true], batch_id: ['text', true], class_id: ['text', true],
    legacy_id: ['jsonb', false], source_path: ['text', true], raw: ['jsonb', true],
    submission_id: ['text', true], student_id: ['text', true], task_id: ['text', true],
    link_state: ['text', true], event: ['text', false], transaction_id: ['text', false],
    amount_at_link: ['numeric', false], unresolved_reason: ['text', false],
  })
  expect(body).toContain('submission_id text NOT NULL REFERENCES migration_v2.submissions(id)')
  expect(body).toContain('student_id text NOT NULL REFERENCES migration_v2.students(id)')
  expect(body).toContain('task_id text NOT NULL REFERENCES migration_v2.tasks(id)')
  expect(body).toContain('transaction_id text REFERENCES migration_v2.transactions(id)')
  expect(body).toContain('UNIQUE (batch_id, source_path)')
})
