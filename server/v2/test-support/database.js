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

  function createPool(options = {}) {
    const pool = new pg.Pool({
      connectionString: databaseUrl.toString(),
      connectionTimeoutMillis: 5000,
      max: 4,
      ...options,
    })
    pools.add(pool)
    return pool
  }

  function verifyWebsiteRole(client, done) {
    client.query('SELECT current_user', (error, result) => {
      if (error) return done(error)
      if (result.rows[0]?.current_user !== 'ppt_web') return done(new Error('測試連線未使用 ppt_web'))
      return done()
    })
  }

  function createWebsitePool() {
    const websiteUrl = new URL(databaseUrl)
    websiteUrl.searchParams.set('options', '-c role=ppt_web')
    return createPool({ connectionString: websiteUrl.toString(), verify: verifyWebsiteRole })
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
    await database.client.query('GRANT SELECT (id, name, passcode_hash, created_at) ON public.teachers TO ppt_web')
    return { ...database, createPool, createWebsitePool, close }
  } catch (error) {
    await close()
    throw error
  }
}
