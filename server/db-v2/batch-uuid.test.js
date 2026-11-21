import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { uuidV5 } from './test-support/batch-uuid.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const dnsNamespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

async function readUuid(client, namespace, name) {
  const { rows: [{ id }] } = await client.query('SELECT ppt.uuid_v5($1, $2) AS id', [namespace, name])
  return id
}

describeDatabase('整批撤銷的 UUID v5', () => {
  const db = useTestDatabase()

  test.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '84983e441c3bd26ebaae4aa1f95129e5e54670f1'],
    ['a'.repeat(1000), '291e9a6c66994949b57ba5e650361e98fc36b1ba'],
  ])('SHA-1 固定向量 %#', async (input, expected) => {
    const { rows: [{ hash }] } = await db().client.query(
      "SELECT encode(ppt.uuid_sha1($1), 'hex') AS hash", [Buffer.from(input)],
    )
    expect(hash).toBe(expected)
  })

  test.each([55, 56, 63, 64, 65, 119, 120])('SHA-1 的 %i 位元組邊界符合 Node', async (length) => {
    const name = 'a'.repeat(length - 16)
    expect(await readUuid(db().client, dnsNamespace, name)).toBe(uuidV5(dnsNamespace, name))
  })

  test('標準範例與二十組隨機 UTF-8 名稱符合 Node', async () => {
    expect(await readUuid(db().client, dnsNamespace, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
    for (let index = 0; index < 20; index += 1) {
      const namespace = randomUUID()
      const name = index === 0 ? '' : '村民' + randomBytes((index * 13) % 98).toString('hex')
      expect(await readUuid(db().client, namespace, name)).toBe(uuidV5(namespace, name))
    }
  })

  test('內部編號符合固定向量、有順序、可重算且只通過 v5 驗證', async () => {
    const undoId = '11111111-1111-4111-8111-111111111111'
    const targetId = '22222222-2222-4222-8222-222222222222'
    const { rows: [ids] } = await db().client.query(`
      SELECT ppt.batch_undo_op_id($1, $2) AS id, ppt.batch_undo_op_id($1, $2) AS again,
             ppt.batch_undo_op_id($2, $1) AS swapped
    `, [undoId, targetId])
    expect(ids.id).toBe('360a0e91-6533-55ad-9380-13030370bb5a')
    expect(ids.again).toBe(ids.id)
    expect(ids.swapped).not.toBe(ids.id)
    const { rows: [format] } = await db().client.query(
      'SELECT ppt.valid_v5_op_id($1) AS v5, ppt.valid_v4_op_id($1) AS v4', [ids.id],
    )
    expect(format).toEqual({ v5: true, v4: false })
  })
})
