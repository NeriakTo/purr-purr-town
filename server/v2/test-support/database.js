import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { openTestDatabase } from '../../db-v2/test-support/database.js'
import { install } from '../install.js'

export async function openWebTestDatabase(url = process.env.PPT_TEST_DATABASE_URL) {
  const database = await openTestDatabase(url)
  const databaseUrl = new URL(url)
  databaseUrl.pathname = '/' + database.name
  databaseUrl.searchParams.delete('database')
  databaseUrl.searchParams.delete('dbname')
  const pools = new Set()

  function createPool() {
    const pool = new pg.Pool({
      connectionString: databaseUrl.toString(),
      connectionTimeoutMillis: 5000,
      max: 4,
    })
    pools.add(pool)
    return pool
  }

  async function close() {
    try {
      await Promise.all([...pools].map(pool => pool.end()))
    } finally {
      await database.close()
    }
  }

  try {
    await database.client.query('SET ROLE ppt_owner')
    try {
      await install(database.client)
    } finally {
      await database.client.query('RESET ROLE')
    }
    await database.client.query(await readFile(new URL('../../schema.sql', import.meta.url), 'utf8'))
    await database.client.query('GRANT SELECT (id, name, passcode_hash) ON public.teachers TO ppt_web')
    return { ...database, createPool, close }
  } catch (error) {
    await close()
    throw error
  }
}
