import { expect, test } from 'vitest'

test('測試資料庫獨立安裝，快照依班級比對資料', async (context) => {
  if (!process.env.PPT_TEST_DATABASE_URL) {
    console.log('T604-SKIP: 未設定 PPT_TEST_DATABASE_URL，略過連資料庫的測試')
    context.skip()
  }
  const { openTestDatabase } = await import('./test-support/database.js')
  const { assertAccountTotals, classSnapshot } = await import('./test-support/checks.js')
  const database = await openTestDatabase()
  try {
    expect(database.name).toMatch(/^ppt_t604_[a-f0-9]+$/)
    await database.client.query(`
      CREATE TABLE ppt.fixture (class_id text, value integer);
      CREATE TABLE IF NOT EXISTS ppt.students (class_id text, student_id text);
      CREATE TABLE IF NOT EXISTS ppt.accounts (class_id text, student_id text, balance numeric, total_earned numeric);
      CREATE TABLE IF NOT EXISTS ppt.transactions (class_id text, student_id text, amount numeric, earned_delta numeric);
    `)
    const before = await classSnapshot(database.client, 'fixture-class')
    await database.client.query("INSERT INTO ppt.fixture VALUES ('other-class', 1)")
    expect(await classSnapshot(database.client, 'fixture-class')).toBe(before)
    await database.client.query("INSERT INTO ppt.fixture VALUES ('fixture-class', 1)")
    expect(await classSnapshot(database.client, 'fixture-class')).not.toBe(before)
  } finally {
    try {
      await assertAccountTotals(database.client)
    } finally {
      await database.close()
    }
  }
}, 15000)
