import { readFile } from 'node:fs/promises'

const roleFile = new URL('./cluster/roles.sql', import.meta.url)
const roleSetupLock = 605

// All callers must connect to the same administrative database.
export async function ensureRoles(client) {
  const sql = await readFile(roleFile, 'utf8')
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)', [roleSetupLock])
    await client.query(sql)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
