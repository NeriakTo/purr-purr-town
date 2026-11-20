import { randomUUID } from 'node:crypto'
import { operation } from './schoolwork.js'

export function correct(classId, id, expected, amount, fields = {}) {
  return operation(classId, 'tx.correct', {
    transaction_id: id, expect_effective_amount: expected, new_amount: amount, ...fields,
  })
}

export function reverse(classId, id, expected) {
  return operation(classId, 'tx.reverse', { transaction_id: id, expect_effective_amount: expected })
}

export async function transactionFrom(client, receipt, index = 0) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM ppt.transactions WHERE transaction_id = $1', [receipt.result.transactions[index]],
  )
  return row
}

export async function addLegacyTransaction(client, { classId, studentId }, {
  kind = 'legacy_general', amount = 0, earned = amount, root = null,
} = {}) {
  const id = randomUUID().replaceAll('-', '').repeat(2)
  await client.query(`
    WITH entry AS (
      INSERT INTO ppt.transactions (class_id, student_id, transaction_id, kind, amount, earned_delta,
        origin, batch_id, reason, occurred_at, effective_at, root_transaction_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'migration', 'fixture-batch', '匯入交易',
        '2025-08-15', CASE WHEN $4 <> 'migration_opening_adjustment' THEN '2025-08-15'::timestamptz END, $7)
      RETURNING *
    )
    UPDATE ppt.accounts a SET balance = a.balance + entry.amount, total_earned = a.total_earned + entry.earned_delta
    FROM entry WHERE a.class_id = entry.class_id AND a.student_id = entry.student_id
  `, [classId, studentId, id, kind, amount, earned, root])
  return id
}
