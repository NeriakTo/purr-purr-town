import { expect, test } from 'vitest'
import { addClass, adjustment } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { addLegacyTransaction, correct, reverse, transactionFrom } from './test-support/transactions.js'

describeDatabase('點數交易的歸屬學期', () => {
  const database = useTestDatabase()

  test('OP-24 按歸屬時間的臺灣日期填學期', async () => {
    const { client } = database()
    const target = await addClass(client)
    const receipt = await commitOperation(client, adjustment(target, 10))
    const { rows: [row] } = await client.query(`
      SELECT semester, ppt.semester_at((effective_at AT TIME ZONE 'Asia/Taipei')::date) AS expected
      FROM ppt.transactions WHERE transaction_id = $1
    `, [receipt.result.transactions[0]])
    expect(row.expected).toEqual(expect.any(String))
    expect(row.semester).toBe(row.expected)
  })

  test('更正與沖回的學期沿用舊根交易的歸屬時間', async () => {
    const { client } = database()
    const target = await addClass(client)
    const root = await addLegacyTransaction(client, target, { amount: 100 })
    const correction = await commitOperation(client, correct(target.classId, root, 100, 80))
    const reversal = await commitOperation(client, reverse(target.classId, root, 80))
    for (const receipt of [correction, reversal]) {
      expect(await transactionFrom(client, receipt)).toMatchObject({ semester: '114-1' })
    }
  })
})
