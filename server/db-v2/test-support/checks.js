import { createHash } from 'node:crypto'
import { expect } from 'vitest'

export async function assertAccountTotals(client) {
  const { rows } = await client.query(`
    WITH totals AS (
      SELECT class_id, student_id, sum(amount) AS balance, sum(earned_delta) AS earned
      FROM ppt.transactions
      GROUP BY class_id, student_id
    )
    SELECT s.class_id, s.student_id
    FROM ppt.students AS s
    LEFT JOIN ppt.accounts AS a USING (class_id, student_id)
    LEFT JOIN totals AS t USING (class_id, student_id)
    WHERE a.balance IS DISTINCT FROM coalesce(t.balance, 0)
       OR a.total_earned IS DISTINCT FROM coalesce(t.earned, 0)
  `)
  expect(rows).toEqual([])
}

export async function classSnapshot(client, classId, { ignoreClassSequence = false } = {}) {
  const { rows: tables } = await client.query(`
    SELECT tablename, format('%I.%I', schemaname, tablename) AS qualified
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'ppt' AND tablename NOT IN ('operations', 'agent_calls')
    ORDER BY tablename
  `)
  const snapshot = createHash('sha256')
  for (const { tablename, qualified } of tables) {
    const value = ignoreClassSequence && tablename === 'classes' ? "to_jsonb(t) - 'class_seq'" : 'to_jsonb(t)'
    const { rows } = await client.query(`
      SELECT (${value})::text AS value
      FROM ${qualified} AS t
      WHERE class_id = $1
      ORDER BY (${value})::text COLLATE "C"
    `, [classId])
    snapshot.update(JSON.stringify([tablename, rows]))
  }
  return snapshot.digest('hex')
}

export async function assertInactiveSubmissionsHaveNoDeductions(client) {
  const { rows } = await client.query(`
    SELECT e.class_id, e.student_id, s.task_id, e.effect_id, e.event
    FROM ppt.effects AS e
    JOIN ppt.submissions AS s
      ON s.class_id = e.class_id AND s.student_id = e.student_id AND s.task_id = e.subject_key
    WHERE e.status = 'active' AND e.subject_kind = 'task'
      AND e.event IN ('submission.late', 'submission.missing') AND NOT s.assignment_active
  `)
  expect(rows).toEqual([])
}
