import { afterAll, afterEach, beforeAll, describe } from 'vitest'
import { assertAccountTotals, assertInactiveSubmissionsHaveNoDeductions } from './checks.js'
import { openTestDatabase } from './database.js'

export const describeDatabase = describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)

export function useTestDatabase() {
  let database
  beforeAll(async () => {
    database = await openTestDatabase()
  }, 15000)
  afterEach(async () => {
    if (database) {
      await assertAccountTotals(database.client)
      await assertInactiveSubmissionsHaveNoDeductions(database.client)
    }
  })
  afterAll(async () => {
    if (database) await database.close()
  }, 15000)
  return () => database
}
