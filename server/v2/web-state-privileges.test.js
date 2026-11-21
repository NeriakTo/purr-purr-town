import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { openTestDatabase } from '../db-v2/test-support/database.js'
import { connectAsRole } from '../db-v2/test-support/roles.js'
import { install } from './install.js'
import { openWebTestDatabase } from './test-support/database.js'
import { createTestSession } from './test-support/fixtures.js'

const roles = ['ppt_web', 'ppt_agent', 'ppt_backup', 'public']
const tablePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const writePrivileges = tablePrivileges.slice(0, 4)

async function assertSchemaPrivileges(client) {
  const { rows } = await client.query(`
    SELECT role, has_schema_privilege(role, n.oid, 'USAGE') AS usage,
           has_schema_privilege(role, n.oid, 'CREATE') AS create
    FROM pg_namespace n CROSS JOIN unnest($1::text[]) AS roles(role)
    WHERE nspname = 'ppt_web_state'
  `, [roles])
  expect(rows).toHaveLength(roles.length)
  for (const row of rows) {
    expect(row.usage, row.role + ' USAGE').toBe(row.role === 'ppt_web')
    expect(row.create, row.role + ' CREATE').toBe(false)
  }
}

async function assertTablePrivileges(client) {
  const { rows } = await client.query(`
    SELECT relname, role, privilege, has_table_privilege(role, c.oid, privilege) AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest($1::text[]) AS roles(role)
    CROSS JOIN unnest($2::text[]) AS privileges(privilege)
    WHERE nspname = 'ppt_web_state' AND relkind = 'r'
  `, [roles, tablePrivileges])
  expect(rows.filter(row => row.relname === 'sessions')).toHaveLength(roles.length * tablePrivileges.length)
  for (const row of rows) {
    expect(row.allowed, [row.relname, row.role, row.privilege].join(' '))
      .toBe(row.role === 'ppt_web' && writePrivileges.includes(row.privilege))
  }

  const { rows: columnGrants } = await client.query(`
    SELECT relname, attname, grantee, privilege_type
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl)
    WHERE nspname = 'ppt_web_state' AND attnum > 0 AND NOT attisdropped
  `)
  expect(columnGrants).toEqual([])
}

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('網站狀態權限', () => {
  let database
  beforeAll(async () => { database = await openWebTestDatabase() }, 15000)
  afterAll(async () => { await database?.close() }, 15000)

  test('W1 網站狀態 schema 與每個物件由 ppt_owner 擁有', async () => {
    const { rows } = await database.client.query(`
      SELECT nspname AS object, pg_get_userbyid(nspowner) AS owner
      FROM pg_namespace WHERE nspname = 'ppt_web_state'
      UNION ALL
      SELECT relname, pg_get_userbyid(relowner)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE nspname = 'ppt_web_state'
    `)
    expect(rows.map(row => row.object)).toEqual(expect.arrayContaining(['ppt_web_state', 'sessions']))
    for (const row of rows) expect(row.owner, row.object).toBe('ppt_owner')
  })

  test('W2 只有網站角色能使用 schema 且四個身分都不能建立物件', async () => {
    await assertSchemaPrivileges(database.client)
  })

  test('W3 逐表逐權限驗證網站角色四項權限與零欄位授權', async () => {
    await assertTablePrivileges(database.client)
  })

  test('W4 網站狀態只含表、索引與表衍生型別', async () => {
    const { rows } = await database.client.query(`
      SELECT relname AS object FROM pg_class
      WHERE relnamespace = 'ppt_web_state'::regnamespace AND relkind NOT IN ('r', 'i')
      UNION ALL
      SELECT proname FROM pg_proc WHERE pronamespace = 'ppt_web_state'::regnamespace
      UNION ALL
      SELECT typname FROM pg_type t
      WHERE typnamespace = 'ppt_web_state'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_type ct ON ct.oid = c.reltype
          WHERE c.relnamespace = t.typnamespace AND c.relkind = 'r' AND t.oid IN (ct.oid, ct.typarray)
        )
    `)
    expect(rows).toEqual([])
  })

  test('W5 網站角色可新增讀取修改刪除，小野與備份讀取被拒', async () => {
    const website = await connectAsRole(database, 'ppt_web')
    await website.query('BEGIN')
    try {
      await createTestSession(website, 'test-teacher')
      const read = await website.query('SELECT teacher_id FROM ppt_web_state.sessions')
      expect(read.rows).toEqual([{ teacher_id: 'test-teacher' }])
      const update = await website.query("UPDATE ppt_web_state.sessions SET teacher_id = 'test-updated'")
      expect(update.rowCount).toBe(1)
      const removal = await website.query("DELETE FROM ppt_web_state.sessions WHERE teacher_id = 'test-updated'")
      expect(removal.rowCount).toBe(1)
    } finally {
      await website.query('ROLLBACK')
    }
    for (const role of ['ppt_agent', 'ppt_backup']) {
      const client = await connectAsRole(database, role)
      await expect(client.query('SELECT token_hash FROM ppt_web_state.sessions')).rejects.toMatchObject({ code: '42501' })
    }
  })

  test('W6 最終授權收回 schema 與表上既有的 PUBLIC 權限', async () => {
    const client = await connectAsRole(database, 'ppt_owner')
    await client.query('BEGIN')
    try {
      await client.query(`
        GRANT ALL ON SCHEMA ppt_web_state TO PUBLIC;
        GRANT ALL ON ALL TABLES IN SCHEMA ppt_web_state TO PUBLIC;
      `)
      const sql = await readFile(new URL('./sql/990-web-state-privileges.sql', import.meta.url), 'utf8')
      await client.query(sql)
      await assertSchemaPrivileges(client)
      await assertTablePrivileges(client)
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('W7 非 ppt_owner 安裝得到 42501 且未建立 schema', async () => {
    const db = await openTestDatabase()
    try {
      await expect(install(db.client)).rejects.toMatchObject({ code: '42501' })
      const { rows } = await db.client.query("SELECT to_regnamespace('ppt_web_state') AS schema")
      expect(rows).toEqual([{ schema: null }])
    } finally {
      await db.close()
    }
  }, 15000)
})
