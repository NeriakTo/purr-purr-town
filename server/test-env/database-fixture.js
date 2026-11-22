import { randomBytes } from 'node:crypto'
import pg from 'pg'

export const adminUrl = process.env.PPT_T609_ADMIN_URL

export function testPassword() {
  return randomBytes(18).toString('hex') + "@:/%'\\"
}

export async function withTestCluster(work) {
  const url = new URL(adminUrl)
  if (url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/postgres'
    || url.search || url.hash) throw new Error('TEST_DATABASE_TARGET_INVALID')
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 })
  const database = 't609_' + randomBytes(8).toString('hex')
  try {
    await admin.connect()
    // 各測試檔共用叢集角色與密碼。
    await admin.query('SELECT pg_advisory_lock(60916)')
    try {
      await work({ admin, database, adminUrl, webPassword: testPassword() })
    } finally {
      await admin.query('DROP DATABASE IF EXISTS ' + pg.escapeIdentifier(database) + ' WITH (FORCE)')
    }
  } finally {
    await admin.end()
  }
}

export async function withTestDatabase(database, work) {
  const url = new URL(adminUrl)
  url.pathname = '/' + database
  const client = new pg.Client({ connectionString: url.href })
  try {
    await client.connect()
    await work(client)
  } finally {
    await client.end()
  }
}
