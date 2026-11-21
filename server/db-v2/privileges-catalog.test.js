import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { databaseRoles } from './test-support/roles.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const applicationSchemas = ['ppt', 'ppt_agent']
const connectionRoles = databaseRoles.filter((role) => role !== 'ppt_owner')
const checkedRoles = [...connectionRoles, 'public']
const schemaUsage = {
  ppt: ['ppt_web', 'ppt_backup'],
  ppt_agent: ['ppt_agent', 'ppt_backup'],
}
const tablePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
const tableReaders = ['ppt_web', 'ppt_backup']
const entrypointRoles = {
  'ppt.submit_operation(jsonb, jsonb)': 'ppt_web',
  'ppt.cancel_operation(text, text, jsonb)': 'ppt_web',
  'ppt_agent.agent_submit(text, text, jsonb, text)': 'ppt_agent',
}

async function assertSchemaPrivileges(client) {
  const { rows } = await client.query(`
    SELECT nspname AS schema, role,
           has_schema_privilege(role, oid, 'CREATE') AS create_allowed,
           has_schema_privilege(role, oid, 'USAGE') AS usage_allowed
    FROM pg_namespace CROSS JOIN unnest($1::text[]) AS roles(role)
  `, [checkedRoles])
  for (const schema of applicationSchemas) {
    expect(rows.some((row) => row.schema === schema), schema + ' schema 存在').toBe(true)
  }
  for (const row of rows) {
    expect(row.create_allowed, `${row.role} CREATE ${row.schema}`).toBe(false)
    if (applicationSchemas.includes(row.schema)) {
      expect(row.usage_allowed, `${row.role} USAGE ${row.schema}`).toBe(schemaUsage[row.schema].includes(row.role))
    }
  }
}

async function assertTablePrivileges(client) {
  const { rows } = await client.query(`
    SELECT nspname AS schema, format('%I.%I', nspname, relname) AS object, role, privilege,
           has_table_privilege(role, c.oid, privilege) AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest($2::text[]) AS roles(role)
    CROSS JOIN unnest($3::text[]) AS privileges(privilege)
    WHERE nspname = ANY($1::text[]) AND relkind IN ('r', 'p', 'v', 'm', 'f')
  `, [applicationSchemas, checkedRoles, tablePrivileges])
  expect(rows.some((row) => row.schema === 'ppt'), 'ppt 的資料表存在').toBe(true)
  for (const row of rows) {
    const expected = row.schema === 'ppt' && row.privilege === 'SELECT' && tableReaders.includes(row.role)
    expect(row.allowed, `${row.role} ${row.privilege} ${row.object}`).toBe(expected)
  }
}

async function assertColumnPrivileges(client) {
  const { rows: agentColumns } = await client.query(`
    SELECT format('%I.%I', nspname, relname) AS object, privilege,
           has_any_column_privilege('ppt_agent', c.oid, privilege) AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest($1::text[]) AS privileges(privilege)
    WHERE nspname = 'ppt' AND relkind IN ('r', 'p', 'v', 'm', 'f')
  `, [columnPrivileges])
  for (const row of agentColumns) {
    expect(row.allowed, `ppt_agent 欄位 ${row.privilege} ${row.object}`).toBe(false)
  }

  const { rows: columnGrants } = await client.query(`
    SELECT format('%I.%I.%I', nspname, relname, attname) AS object,
           CASE WHEN grantee = 0 THEN 'public' ELSE pg_get_userbyid(grantee) END AS role,
           privilege_type AS privilege
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl)
    WHERE nspname = ANY($1::text[]) AND attnum > 0 AND NOT attisdropped
  `, [applicationSchemas])
  for (const row of columnGrants) {
    expect(checkedRoles, `${row.role} 欄位 ${row.privilege} ${row.object}`).not.toContain(row.role)
  }
}

async function assertExecutePrivileges(client) {
  const { rows } = await client.query(`
    SELECT format('%I.%I(%s)', nspname, proname, oidvectortypes(proargtypes)) AS object,
           role, has_function_privilege(role, p.oid, 'EXECUTE') AS allowed
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest($2::text[]) AS roles(role)
    WHERE nspname = ANY($1::text[])
  `, [applicationSchemas, checkedRoles])
  for (const [entrypoint, role] of Object.entries(entrypointRoles)) {
    expect(rows.some((row) => row.object === entrypoint), `${role} EXECUTE ${entrypoint} 存在`).toBe(true)
  }
  for (const row of rows) {
    expect(row.allowed, `${row.role} EXECUTE ${row.object}`).toBe(entrypointRoles[row.object] === row.role)
  }
}

async function assertFunctionSettings(client) {
  const { rows } = await client.query(`
    SELECT format('%I.%I(%s)', nspname, proname, oidvectortypes(proargtypes)) AS object,
           pg_get_userbyid(proowner) AS owner, prosecdef, proconfig,
           coalesce(pg_get_function_sqlbody(p.oid), prosrc) AS body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE nspname = ANY($1::text[])
  `, [applicationSchemas])
  const definers = new Set()
  for (const { object, owner, prosecdef, proconfig, body } of rows) {
    if (prosecdef) definers.add(object)
    expect(prosecdef, `${owner} SECURITY DEFINER ${object}`).toBe(Object.hasOwn(entrypointRoles, object))
    const config = proconfig?.find((setting) => setting.startsWith('search_path='))
    expect(config, `${owner} search_path ${object}`).toBeDefined()
    const path = config.slice('search_path='.length).split(',').map((schema) => schema.trim())
    expect(path[0], `${owner} search_path 首項 ${object}`).toBe('pg_catalog')
    expect(path.at(-1), `${owner} search_path 末項 ${object}`).toBe('pg_temp')
    expect(body, `${owner} 函式身分判斷 ${object}`).not.toMatch(/\b(current_user|session_user|current_role)\b/i)
  }
  for (const entrypoint of Object.keys(entrypointRoles)) {
    expect(definers.has(entrypoint), `ppt_owner SECURITY DEFINER ${entrypoint} 存在`).toBe(true)
  }
}

async function assertRoleProperties(client) {
  const { rows } = await client.query(`
    SELECT rolname AS role, rolcanlogin AS "LOGIN", rolsuper AS "SUPERUSER",
           rolcreatedb AS "CREATEDB", rolcreaterole AS "CREATEROLE", rolreplication AS "REPLICATION",
           rolbypassrls AS "BYPASSRLS", rolpassword IS NOT NULL AS "PASSWORD",
           rolconnlimit AS "CONNECTION LIMIT"
    FROM pg_authid WHERE rolname = ANY($1::text[])
  `, [databaseRoles])
  for (const role of databaseRoles) {
    const row = rows.find((row) => row.role === role)
    expect(row, role + ' 角色存在').toBeDefined()
    const { role: roleName, 'CONNECTION LIMIT': limit, ...properties } = row
    for (const [property, enabled] of Object.entries(properties)) {
      expect(enabled, `${roleName} ${property}`).toBe(false)
    }
    expect(limit, roleName + ' CONNECTION LIMIT').toBe(roleName === 'ppt_agent' ? 5 : -1)
  }
}

async function assertRoleMemberships(client) {
  const { rows } = await client.query(`
    WITH RECURSIVE memberships AS (
      SELECT oid AS member, oid AS inherited FROM pg_roles WHERE rolname = ANY($1::text[])
      UNION
      SELECT m.member, a.roleid FROM memberships m JOIN pg_auth_members a ON a.member = m.inherited
    )
    SELECT pg_get_userbyid(member) AS member, pg_get_userbyid(inherited) AS inherited
    FROM memberships JOIN pg_roles r ON r.oid = inherited
    WHERE member <> inherited AND (r.rolname = ANY($1::text[]) OR starts_with(r.rolname, 'pg_'))
  `, [databaseRoles])
  expect(rows.map(({ member, inherited }) => `${member} MEMBER ${inherited}`)).toEqual([])
}

async function assertRoleSettings(client) {
  const expectedSettings = {
    ppt_owner: [],
    ppt_web: [],
    ppt_agent: ['idle_in_transaction_session_timeout=30s', 'lock_timeout=10s', 'statement_timeout=30s'],
    ppt_backup: ['default_transaction_read_only=on'],
  }
  const { rows } = await client.query(`
    SELECT rolname AS role, coalesce(setconfig, '{}'::text[]) AS settings
    FROM pg_roles LEFT JOIN pg_db_role_setting ON setrole = oid AND setdatabase = 0
    WHERE rolname = ANY($1::text[])
  `, [databaseRoles])
  for (const { role, settings } of rows) {
    expect(settings.sort(), role + ' ALTER ROLE SET').toEqual(expectedSettings[role])
  }
}

describeDatabase('資料庫權限清點', () => {
  const database = useTestDatabase()

  it('C02 schema 的 USAGE 和 CREATE 符合白名單', async () => {
    await assertSchemaPrivileges(database().client)
  })

  it('C03 所有應用表與欄位權限符合白名單', async () => {
    const { client } = database()
    await assertTablePrivileges(client)
    await assertColumnPrivileges(client)
  })

  it('C04 只有指定連線角色可執行各自的入口', async () => {
    await assertExecutePrivileges(database().client)
  })

  it('C05 只有三支函式以擁有者身分執行且每支皆固定搜尋順序', async () => {
    await assertFunctionSettings(database().client)
  })

  it('C07 角色屬性、成員關係與登入設定符合契約', async () => {
    const { client } = database()
    await assertRoleProperties(client)
    await assertRoleMemberships(client)
    await assertRoleSettings(client)
  })

  it('C02 與 C04 最終授權會收回現存的 PUBLIC 權限', async () => {
    const { client } = database()
    const sql = await readFile(new URL('./sql/990-privileges.sql', import.meta.url), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(`
        SET LOCAL ROLE ppt_owner;
        GRANT ALL ON SCHEMA ppt, ppt_agent TO PUBLIC;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ppt, ppt_agent TO PUBLIC;
      `)
      await client.query(sql)
      await assertSchemaPrivileges(client)
      await assertExecutePrivileges(client)
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
