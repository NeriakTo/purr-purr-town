import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { connectAsRole, databaseRoles } from './test-support/roles.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

const applicationSchemas = ['ppt', 'ppt_agent']
const connectionRoles = databaseRoles.filter((role) => role !== 'ppt_owner')
const checkedRoles = [...connectionRoles, 'public']
const schemaUsage = {
  ppt: ['ppt_web', 'ppt_backup'],
  ppt_agent: ['ppt_agent', 'ppt_backup'],
}
const tablePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const sequencePrivileges = ['USAGE', 'SELECT', 'UPDATE']
const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
const tableReaders = ['ppt_web', 'ppt_backup']
const entrypointRoles = {
  'ppt.submit_operation(jsonb, jsonb)': 'ppt_web',
  'ppt.cancel_operation(text, text, jsonb)': 'ppt_web',
  'ppt_agent.agent_submit(text, text, jsonb, text)': 'ppt_agent',
}
const invokerFunctionRoles = {
  'ppt.can_access_class(text, jsonb)': 'ppt_web',
  'ppt.system_actor()': 'ppt_web',
  'ppt_agent.mask_student_names(text, jsonb)': 'ppt_agent',
}
const executeRoles = { ...entrypointRoles, ...invokerFunctionRoles }

async function withOwnerTransaction(database, check) {
  const client = await connectAsRole(database, 'ppt_owner')
  await client.query('BEGIN')
  try {
    await check(client)
  } finally {
    await client.query('ROLLBACK')
  }
}

async function typeUsageRows(client) {
  const { rows } = await client.query(`
    SELECT format('%I.%I', n.nspname, t.typname) AS object,
           role, has_type_privilege(role, t.oid, 'USAGE') AS allowed
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_class c ON c.oid = t.typrelid
    CROSS JOIN unnest($2::text[]) AS roles(role)
    WHERE n.nspname = ANY($1::text[])
      AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND c.relkind = 'c'))
  `, [applicationSchemas, checkedRoles])
  return rows
}

function assertTypeUsageDenied(rows) {
  for (const { object, role, allowed } of rows) {
    expect(allowed, `${role} USAGE ${object}`).toBe(false)
  }
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
    SELECT nspname AS schema, format('%I.%I', nspname, relname) AS object, relkind, role, privilege,
           CASE WHEN relkind = 'S' THEN has_sequence_privilege(role, c.oid, privilege)
                ELSE has_table_privilege(role, c.oid, privilege) END AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest($2::text[]) AS roles(role)
    CROSS JOIN LATERAL unnest(CASE WHEN relkind = 'S' THEN $4::text[] ELSE $3::text[] END) AS privileges(privilege)
    WHERE nspname = ANY($1::text[]) AND relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  `, [applicationSchemas, checkedRoles, tablePrivileges, sequencePrivileges])
  expect(rows.some((row) => row.schema === 'ppt' && row.relkind !== 'S'), 'ppt 的資料表存在').toBe(true)
  for (const row of rows) {
    const expected = row.privilege === 'SELECT' && (
      (row.relkind !== 'S' && row.schema === 'ppt' && tableReaders.includes(row.role))
      || (row.relkind === 'v' && row.schema === 'ppt_agent' && row.role === 'ppt_agent')
    )
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
  for (const [object, role] of Object.entries(executeRoles)) {
    expect(rows.some((row) => row.object === object), `${role} EXECUTE ${object} 存在`).toBe(true)
  }
  for (const row of rows) {
    expect(row.allowed, `${row.role} EXECUTE ${row.object}`).toBe(executeRoles[row.object] === row.role)
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
    expect(config, `${owner} search_path ${object}`).toBe('search_path=pg_catalog, ppt, pg_temp')
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

const expectedAgentViews = [
  'accounts', 'agent_calls', 'classes', 'confirmations', 'corrections', 'daily_duties',
  'groups', 'held_batches', 'job_assignees', 'jobs', 'operations', 'rule_versions', 'rules',
  'students', 'submissions', 'tasks', 'transactions',
]

async function agentSchemaObjects(client) {
  const { rows } = await client.query(`
    WITH namespace AS (
      SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'ppt_agent'
    ), relations AS (
      SELECT c.* FROM pg_catalog.pg_class c JOIN namespace n ON n.oid = c.relnamespace
    ), view_types AS (
      SELECT reltype FROM relations WHERE relkind = 'v'
    )
    SELECT relkind::text || ':' || relname AS object FROM relations
    UNION ALL
    SELECT p.prokind::text || ':' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'
    FROM pg_catalog.pg_proc p JOIN namespace n ON n.oid = p.pronamespace
    UNION ALL
    SELECT 'type:' || t.typname
    FROM pg_catalog.pg_type t JOIN namespace n ON n.oid = t.typnamespace
    WHERE NOT EXISTS (SELECT 1 FROM view_types v WHERE v.reltype IN (t.oid, t.typelem))
  `)
  return rows.map(row => row.object).sort()
}

async function viewSelectAccess(client, view, roles) {
  const { rows } = await client.query(`
    SELECT role, pg_catalog.has_table_privilege(role, $1::regclass, 'SELECT') AS allowed
    FROM pg_catalog.unnest($2::text[]) AS roles(role)
  `, [view, roles])
  return Object.fromEntries(rows.map(({ role, allowed }) => [role, allowed]))
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

  it('C03 能抓到序列的 USAGE、SELECT 與 UPDATE 授權', async () => {
    await withOwnerTransaction(database(), async (client) => {
      await client.query('CREATE SEQUENCE ppt.test_sequence')
      await assertTablePrivileges(client)
      for (const privilege of sequencePrivileges) {
        await client.query(`GRANT ${privilege} ON SEQUENCE ppt.test_sequence TO ppt_web`)
        await expect(assertTablePrivileges(client)).rejects.toThrow(`ppt_web ${privilege} ppt.test_sequence`)
        await client.query(`REVOKE ${privilege} ON SEQUENCE ppt.test_sequence FROM ppt_web`)
      }
    })
  })

  it('C04 只有指定連線角色可執行各自的入口或輔助函式', async () => {
    await assertExecutePrivileges(database().client)
  })

  it('C03 能抓到小野檢視表超出 SELECT 白名單的每種授權', async () => {
    await withOwnerTransaction(database(), async (client) => {
      await client.query('CREATE VIEW ppt_agent.test_view AS SELECT 1 AS sample')
      await client.query('GRANT SELECT ON ppt_agent.test_view TO ppt_agent')
      await assertTablePrivileges(client)

      for (const role of ['ppt_web', 'ppt_backup', 'PUBLIC']) {
        await client.query(`GRANT SELECT ON ppt_agent.test_view TO ${role}`)
        await expect(assertTablePrivileges(client)).rejects.toThrow('SELECT ppt_agent.test_view')
        await client.query(`REVOKE SELECT ON ppt_agent.test_view FROM ${role}`)
      }
      for (const privilege of tablePrivileges.filter((name) => name !== 'SELECT')) {
        await client.query(`GRANT ${privilege} ON ppt_agent.test_view TO ppt_agent`)
        await expect(assertTablePrivileges(client)).rejects.toThrow(`ppt_agent ${privilege} ppt_agent.test_view`)
        await client.query(`REVOKE ${privilege} ON ppt_agent.test_view FROM ppt_agent`)
      }
    })
  })

  it('C05 只有三支函式以擁有者身分執行且每支皆固定搜尋順序', async () => {
    await assertFunctionSettings(database().client)
  })

  it('C05 能抓到首尾正確但中間有其他 schema 的搜尋順序', async () => {
    await withOwnerTransaction(database(), async (client) => {
      await client.query('ALTER FUNCTION ppt.system_actor() SET search_path = pg_catalog, public, pg_temp')
      await expect(assertFunctionSettings(client)).rejects.toThrow('search_path ppt.system_actor()')
    })
  })

  it('C06 新建型別預設封閉 PUBLIC 與三個連線角色的 USAGE', async () => {
    await withOwnerTransaction(database(), async (client) => {
      await client.query("CREATE TYPE ppt.test_default_usage AS ENUM ('測試')")
      const types = await typeUsageRows(client)
      const created = types.filter(({ object }) => object === 'ppt.test_default_usage')
      expect(created).toHaveLength(checkedRoles.length)
      assertTypeUsageDenied(created)
      await client.query('DROP TYPE ppt.test_default_usage')
    })
  })

  it('最終授權收回兩個 schema 既有 enum、domain 和獨立複合型別的 PUBLIC USAGE', async () => {
    await withOwnerTransaction(database(), async (client) => {
      await client.query(`
        CREATE TYPE ppt.test_enum AS ENUM ('測試');
        CREATE DOMAIN ppt_agent.test_domain AS text;
        CREATE TYPE ppt_agent.test_composite AS (value text);
        GRANT USAGE ON TYPE ppt.test_enum, ppt_agent.test_domain, ppt_agent.test_composite TO PUBLIC;
      `)
      const finalPrivileges = await readFile(new URL('./sql/990-privileges.sql', import.meta.url), 'utf8')
      await client.query(finalPrivileges)
      const types = await typeUsageRows(client)
      for (const name of ['ppt.test_enum', 'ppt_agent.test_domain', 'ppt_agent.test_composite']) {
        expect(types.filter(({ object }) => object === name)).toHaveLength(checkedRoles.length)
      }
      assertTypeUsageDenied(types)
    })
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

  it('C09 每個小野檢視表都有 security_barrier=true', async () => {
    const { rows } = await database().client.query(`
      SELECT c.relname AS name, c.reloptions AS options
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ppt_agent' AND c.relkind = 'v'
    `)
    expect(rows.map(row => row.name).sort()).toEqual(expectedAgentViews)
    for (const { name, options } of rows) {
      expect(options ?? [], 'ppt_agent.' + name).toContain('security_barrier=true')
    }
  })

  it('小野 schema 只包含契約的十七個檢視表與兩支函式', async () => {
    expect(await agentSchemaObjects(database().client)).toEqual([
      ...expectedAgentViews.map(name => 'v:' + name),
      'f:agent_submit(text, text, jsonb, text)',
      'f:mask_student_names(text, jsonb)',
    ].sort())
  })

  it('新建小野檢視表預設不授予 PUBLIC 或三個連線角色 SELECT', async () => {
    await withOwnerTransaction(database(), async (client) => {
      const view = 'ppt_agent.test_view_default_select'
      await client.query('CREATE VIEW ' + view + ' AS SELECT 1 AS sample')
      expect(await viewSelectAccess(client, view, checkedRoles)).toEqual(
        Object.fromEntries(checkedRoles.map(role => [role, false])),
      )
      await client.query('DROP VIEW ' + view)
    })
  })

  it('重跑最終授權會收回每個既有小野檢視表的 PUBLIC SELECT', async () => {
    const sql = await readFile(new URL('./sql/990-privileges.sql', import.meta.url), 'utf8')
    await withOwnerTransaction(database(), async (client) => {
      const views = expectedAgentViews.map(name => 'ppt_agent.' + name)
      await client.query('GRANT SELECT ON ' + views.join(', ') + ' TO PUBLIC')
      for (const view of views) expect(await viewSelectAccess(client, view, ['public']), view).toEqual({ public: true })
      await client.query(sql)
      for (const view of views) {
        expect(await viewSelectAccess(client, view, checkedRoles), view).toEqual({
          ppt_agent: true, ppt_web: false, ppt_backup: false, public: false,
        })
      }
    })
  })
})
