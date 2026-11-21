import { expect, it } from 'vitest'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const viewColumns = {
  classes: {
    class_id: 'text', status: 'text', class_seq: 'int8', last_committed_at: 'timestamptz',
  },
  students: {
    class_id: 'text', student_id: 'text', seat_number: 'int4', group_key: 'text', enrollment_status: 'text',
  },
  groups: {
    class_id: 'text', group_key: 'text', name: 'text', leader_student_id: 'text',
  },
  accounts: {
    class_id: 'text', student_id: 'text', balance: 'numeric', total_earned: 'numeric',
  },
  transactions: {
    class_id: 'text', transaction_id: 'text', student_id: 'text', kind: 'text', amount: 'numeric',
    earned_delta: 'numeric', occurred_at: 'timestamptz', effective_at: 'timestamptz', semester: 'text',
    rule_id: 'text', rule_rev: 'int4', rule_name: 'text', root_transaction_id: 'text', op_id: 'text',
  },
  rules: {
    class_id: 'text', rule_id: 'text', kind: 'text', event: 'text', disabled: 'bool', rev: 'int4',
    name: 'text', amount: 'numeric', icon: 'text', category: 'text', effective_at: 'timestamptz',
  },
  rule_versions: {
    class_id: 'text', rule_id: 'text', rev: 'int4', name: 'text', amount: 'numeric',
    icon: 'text', category: 'text', effective_at: 'timestamptz',
  },
}

async function readViewColumns(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS view, pg_get_userbyid(c.relowner) AS owner,
           c.reloptions, a.attname AS column, t.typname AS type,
           t.typtype AS type_kind, tn.nspname AS type_schema
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname = 'ppt_agent' AND c.relkind = 'v' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `)
  return rows
}

describeDatabase('小野檢視表的欄位契約', () => {
  const database = useTestDatabase()

  it('欄名、順序與型別逐欄符合契約，擁有者正確且未開 security_invoker', async () => {
    const actual = await readViewColumns(database().client)
    expect([...new Set(actual.map(row => row.view))].sort()).toEqual(Object.keys(viewColumns).sort())
    for (const [view, columns] of Object.entries(viewColumns)) {
      const rows = actual.filter(row => row.view === view)
      expect(rows.map(row => [row.column, row.type]), view).toEqual(Object.entries(columns))
      for (const row of rows) {
        expect(row.owner, view).toBe('ppt_owner')
        expect(row.reloptions ?? [], view).not.toContainEqual(expect.stringMatching(/^security_invoker=/))
        expect(row.type_kind, view).toBe('b')
        expect(row.type_schema, view).toBe('pg_catalog')
      }
    }
  })
})
