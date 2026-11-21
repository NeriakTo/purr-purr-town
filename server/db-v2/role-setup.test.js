import { expect, it } from 'vitest'
import { ensureRoles } from './roles.js'
import { openAdminConnection } from './test-support/database.js'
import { connectAsRole, databaseRoles } from './test-support/roles.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const expectedAttributes = {
  rolcanlogin: false,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolreplication: false,
  rolbypassrls: false,
}

async function assertRoleAttributes(client) {
  const { rows } = await client.query(`
    SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls, rolconnlimit
    FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname
  `, [databaseRoles])
  expect(rows).toEqual([...databaseRoles].sort().map((rolname) => ({
    rolname,
    ...expectedAttributes,
    rolconnlimit: rolname === 'ppt_agent' ? 5 : -1,
  })))
}

async function withAdminConnections(count, action) {
  const clients = []
  try {
    for (let index = 0; index < count; index++) clients.push(await openAdminConnection())
    await action(...clients)
  } finally {
    await Promise.all(clients.map((client) => client.end()))
  }
}

async function assertRoleInstalled(client, role) {
  const { rows: [{ exists }] } = await client.query(
    'SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = $1)', [role],
  )
  expect(exists, role).toBe(true)
}

describeDatabase('資料庫角色安裝', () => {
  const database = useTestDatabase()

  it('建立四個受限角色', async () => {
    await assertRoleAttributes(database().client)
  })

  it('同一條管理連線可重跑兩次', async () => {
    await withAdminConnections(1, async (admin) => {
      await ensureRoles(admin)
      await ensureRoles(admin)
      await assertRoleInstalled(admin, 'ppt_owner')
    })
  })

  it('兩條管理連線同時設定角色', async () => {
    await withAdminConnections(2, async (first, second) => {
      const results = await Promise.allSettled([ensureRoles(first), ensureRoles(second)])
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
      }
      await assertRoleInstalled(first, 'ppt_owner')
    })
  })

  it('四個角色都能切入並重設成管理身分', async () => {
    const { rows: [{ current_user: admin }] } = await database().client.query('SELECT current_user')
    for (const role of databaseRoles) {
      const client = await connectAsRole(database(), role)
      try {
        await client.query('RESET ROLE')
        const { rows: [{ current_user: restored }] } = await client.query('SELECT current_user')
        expect(restored, role).toBe(admin)
      } finally {
        await client.end()
      }
    }
  })
})
