import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { install } from './install.js'
import { openAdminConnection } from './test-support/database.js'
import { connectAsRole, databaseRoles } from './test-support/roles.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const nonOwners = ['public', ...databaseRoles.filter((role) => role !== 'ppt_owner')]

async function withEmptyDatabase(action) {
  const name = 'ppt_t604_' + randomUUID().replaceAll('-', '')
  const url = new URL(process.env.PPT_TEST_DATABASE_URL)
  url.pathname = '/' + name
  url.searchParams.delete('database')
  url.searchParams.delete('dbname')
  const admin = await openAdminConnection()
  try {
    await admin.query('CREATE DATABASE ' + name + ' OWNER ppt_owner')
    try {
      const client = await openAdminConnection(url.toString())
      try {
        await action(client)
      } finally {
        await client.end()
      }
    } finally {
      await admin.query('DROP DATABASE ' + name)
    }
  } finally {
    await admin.end()
  }
}

async function listOwnedObjects(client) {
  const { rows } = await client.query(`
    WITH schemas AS (
      SELECT oid, nspname, nspowner FROM pg_namespace WHERE nspname IN ('ppt', 'ppt_agent')
    )
    SELECT 'schema ' || nspname AS object, pg_get_userbyid(nspowner) AS owner FROM schemas
    UNION ALL
    SELECT format('%I.%I', nspname, relname), pg_get_userbyid(relowner)
    FROM pg_class JOIN schemas ON schemas.oid = relnamespace
    UNION ALL
    SELECT p.oid::regprocedure::text, pg_get_userbyid(proowner)
    FROM pg_proc p JOIN schemas ON schemas.oid = pronamespace
    UNION ALL
    SELECT format('%I.%I', nspname, typname), pg_get_userbyid(typowner)
    FROM pg_type t JOIN schemas ON schemas.oid = typnamespace
  `)
  return rows
}

describeDatabase('資料庫安裝身分與預設權限', () => {
  const database = useTestDatabase()

  it('管理身分直接安裝會先遭拒並保留空庫', async () => {
    await withEmptyDatabase(async (client) => {
      await expect(install(client)).rejects.toMatchObject({ code: '42501' })
      const { rows: [{ schema }] } = await client.query("SELECT to_regnamespace('ppt') AS schema")
      expect(schema).toBeNull()
    })
  })

  it('C01 所有應用物件均由非超級使用者 ppt_owner 擁有', async () => {
    const { client } = database()
    const { rows: [{ rolsuper }] } = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = 'ppt_owner'")
    expect(rolsuper, 'ppt_owner SUPERUSER').toBe(false)
    const objects = await listOwnedObjects(client)
    expect(objects.map(({ object }) => object)).toContain('schema ppt')
    for (const { object, owner } of objects) expect(owner, object).toBe('ppt_owner')
  })

  it('C06 擁有者新增的函式預設不給 PUBLIC 或連線角色執行', async () => {
    const owner = await connectAsRole(database(), 'ppt_owner')
    try {
      await owner.query("CREATE FUNCTION ppt.test_default_execute() RETURNS integer LANGUAGE sql AS 'SELECT 1'")
      try {
        const { rows } = await owner.query(`
          SELECT role, has_function_privilege(role, 'ppt.test_default_execute()', 'EXECUTE') AS allowed
          FROM unnest($1::text[]) AS role
        `, [nonOwners])
        for (const { role, allowed } of rows) expect(allowed, role + ' EXECUTE ppt.test_default_execute()').toBe(false)
      } finally {
        await owner.query('DROP FUNCTION ppt.test_default_execute()')
      }
    } finally {
      await owner.end()
    }
  })

  it('C08 PUBLIC 與連線角色都沒有測試資料庫的 TEMP', async () => {
    const { rows } = await database().client.query(`
      SELECT role, has_database_privilege(role, current_database(), 'TEMP') AS allowed
      FROM unnest($1::text[]) AS role
    `, [nonOwners])
    for (const { role, allowed } of rows) expect(allowed, role + ' TEMP').toBe(false)
  })
})
