import { expect, test } from 'vitest'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const legacyId = 'a'.repeat(64)

async function addStudent(client, classId, studentId = legacyId) {
  await client.query(`
    INSERT INTO ppt.classes (class_id) VALUES ($1);
  `, [classId])
  await client.query(`
    INSERT INTO ppt.students (class_id, student_id, seat_number, name)
    VALUES ($1, $2, 1, '1號村民')
  `, [classId, studentId])
  await client.query('INSERT INTO ppt.accounts (class_id, student_id) VALUES ($1, $2)', [classId, studentId])
}

function addTransaction(client, { id, kind = 'legacy_general', root = null, origin = 'migration', op = null, batch = 'batch' }) {
  return client.query(`
    INSERT INTO ppt.transactions
      (class_id, student_id, transaction_id, kind, root_transaction_id,
       origin, op_id, batch_id, amount, earned_delta, occurred_at, reason)
    VALUES ('ledger', $1, $2, $3, $4, $5, $6, $7, 0, 0, clock_timestamp(), '')
  `, [legacyId, id, kind, root, origin, op, batch])
}

describeDatabase('第一批資料表', () => {
  const db = useTestDatabase()

  test('匯入長編號可跨班共用，版本從一開始，每班只有一位擁有者', async () => {
    const { client } = db()
    await addStudent(client, 'first')
    await addStudent(client, 'second')
    await client.query("INSERT INTO ppt.class_ownership VALUES ('first', 'owner-a')")
    await expect(client.query("INSERT INTO ppt.class_ownership VALUES ('first', 'owner-b')"))
      .rejects.toMatchObject({ code: '23505' })
    const { rows } = await client.query(`
      SELECT class_id, rev, last_op_id FROM ppt.accounts
      WHERE student_id = $1 ORDER BY class_id
    `, [legacyId])
    expect(rows).toEqual([
      { class_id: 'first', rev: 1, last_op_id: null },
      { class_id: 'second', rev: 1, last_op_id: null },
    ])
    await expect(client.query("UPDATE ppt.classes SET status = 'invalid' WHERE class_id = 'first'"))
      .rejects.toMatchObject({ code: '23514' })
  })

  test('交易來源互斥、根交易只沖回一次、存摺只能新增', async () => {
    const { client } = db()
    await addStudent(client, 'ledger')
    await expect(addTransaction(client, { id: 'bad1', origin: 'op', batch: null }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(addTransaction(client, { id: 'bad2', origin: 'migration', op: 'unexpected' }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(addTransaction(client, { id: 'bad3', origin: 'migration', batch: null }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(addTransaction(client, { id: 'bad4', origin: 'op', op: 'unexpected' }))
      .rejects.toMatchObject({ code: '23514' })
    await addTransaction(client, { id: 'root' })
    await addTransaction(client, { id: 'reverse1', kind: 'reversal', root: 'root' })
    await expect(addTransaction(client, { id: 'reverse2', kind: 'reversal', root: 'root' }))
      .rejects.toMatchObject({ code: '23505' })
    await expect(client.query("UPDATE ppt.transactions SET reason = '改寫'"))
      .rejects.toMatchObject({ code: '55000' })
    await expect(client.query('DELETE FROM ppt.transactions')).rejects.toMatchObject({ code: '55000' })
    await expect(client.query('TRUNCATE ppt.transactions')).rejects.toMatchObject({ code: '55000' })
  })
})
