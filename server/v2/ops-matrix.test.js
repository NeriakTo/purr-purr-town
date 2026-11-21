import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { adjustment, classSequence, submit } from '../db-v2/test-support/operations.js'
import { cancelViaHttp, lookupViaHttp, sendOperationRequest } from './test-support/operation-http.js'
import { assertNoOperationWrites, assertNoWrites, readOperation, useOpsFixtures } from './test-support/ops.js'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('放棄與查詢補齊四類驗收', () => {
  const fixture = useOpsFixtures()

  test.each([
    ['放棄', (context, id) => cancelViaHttp(context, id, undefined, { token: null })],
    ['查詢', (context, id) => lookupViaHttp(context, [id], undefined, { token: null })],
  ])('%s 沒帶權杖回 AUTH_REQUIRED 且無寫入', async (_, send) => {
    const context = fixture()
    const response = await send(context, randomUUID())
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
    await assertNoWrites(context.client, context.target.classId)
  })

  test('放棄明寫 READ COMMITTED，資料庫預設為 repeatable read 仍可登記', async () => {
    const context = fixture()
    const { client, database } = context
    await client.query(`ALTER DATABASE ${database.name} SET default_transaction_isolation TO 'repeatable read'`)
    try {
      const app = context.makeApp()
      const opId = randomUUID()
      const response = await cancelViaHttp(context, opId, undefined, { app })
      expect(response.statusCode).toBe(200)
      expect(response.json().receipt).toMatchObject({ status: 'cancelled', code: 'OP_CANCELLED' })
      expect((await readOperation(client, opId)).receipt).toEqual(response.json().receipt)
    } finally {
      await client.query(`ALTER DATABASE ${database.name} RESET default_transaction_isolation`)
    }
  })

  test('查詢重送逐位元組相同，使用唯讀快照且班級序號不變', async () => {
    const context = fixture()
    const { client, database, target, teacher } = context
    const op = adjustment(target)
    const receipt = await submit(client, op, teacher)
    expect(receipt).toMatchObject({ status: 'committed' })
    const pool = database.createPool()
    const statements = []
    pool.on('connect', connection => {
      const query = connection.query.bind(connection)
      connection.query = (sql, ...parameters) => {
        statements.push(sql.trim())
        return query(sql, ...parameters)
      }
    })
    const app = context.makeApp({ pool })
    const options = { app }
    const missingId = randomUUID()
    const ids = [op.op_id, missingId]
    const first = await lookupViaHttp(context, ids, target.classId, options)
    const second = await lookupViaHttp(context, ids, target.classId, options)
    expect([first.statusCode, second.statusCode]).toEqual([200, 200])
    expect(first.rawPayload).toEqual(second.rawPayload)
    expect(first.json().results).toEqual([
      { ...receipt, op_type: op.type }, { op_id: missingId, status: 'unknown' },
    ])
    const boundaries = statements.filter(sql => /^(BEGIN|COMMIT)/.test(sql))
    expect(boundaries).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT',
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT',
    ])
    expect(await classSequence(client, target.classId)).toBe(receipt.class_seq)
    expect((await readOperation(client, op.op_id)).receipt).toEqual(receipt)
    await assertNoOperationWrites(client, missingId)
  })

  test('放棄的 op_id 不是字串時回 400 且無寫入', async () => {
    const context = fixture()
    const classId = context.target.classId
    const response = await sendOperationRequest(context, 'cancel', { class_id: classId, op_id: 1 })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    await assertNoWrites(context.client, classId)
  })
})
