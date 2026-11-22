import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { ensureRoles } from '../db-v2/roles.js'
import { install as installDatabase } from '../db-v2/install.js'
import { install as installWebState } from '../v2/install.js'
import { ConfigError, isEntryPoint, readSecret } from './secrets.js'

const defaultDatabase = 'ppt_test'
const installMarker = 'purrtown-test installation v1'
const schemas = ['ppt', 'ppt_agent', 'ppt_web_state']
const locales = new Set(['en_US.UTF-8', 'en_US.utf8'])
const legacySchema = new URL('../schema.sql', import.meta.url)

class SetupError extends Error {
  constructor(step, code, error) {
    const sqlstate = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
      ? ' ' + error.code
      : ''
    super('步驟 ' + step + ' ' + code + sqlstate)
    this.step = step
    this.code = code
  }
}

async function atStep(step, code, work) {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SetupError) throw error
    throw new SetupError(step, code, error)
  }
}

function checkDatabaseName(database) {
  if (typeof database !== 'string' || !database || Buffer.byteLength(database) > 63
    || database.includes('\0') || ['postgres', 'template0', 'template1'].includes(database)) {
    throw new SetupError('2', 'DATABASE_NAME_INVALID')
  }
}

function connectUrl(adminUrl, database) {
  const url = new URL(adminUrl)
  url.pathname = '/' + encodeURIComponent(database)
  url.searchParams.delete('dbname')
  url.searchParams.delete('database')
  return url
}

async function withClient(url, work) {
  const client = new pg.Client({ connectionString: String(url), connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    return await work(client)
  } finally {
    await client.end()
  }
}

async function inTransaction(client, work) {
  await client.query('BEGIN')
  try {
    await work()
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function databaseAttributes(client, database) {
  const { rows: [row] } = await client.query(`
    SELECT pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding,
           datcollate, datctype
    FROM pg_database WHERE datname = $1
  `, [database])
  return row
}

function hasExpectedLocale(database) {
  return locales.has(database?.datcollate) && locales.has(database?.datctype)
}

async function ensureDatabase(client, database) {
  if (!(await databaseAttributes(client, database))) {
    await client.query(`
      CREATE DATABASE ${pg.escapeIdentifier(database)} OWNER ppt_owner TEMPLATE template0
      ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'
    `)
  }
  const attrs = await databaseAttributes(client, database)
  if (attrs?.owner !== 'ppt_owner' || attrs.encoding !== 'UTF8' || !hasExpectedLocale(attrs)) {
    throw new SetupError('2', 'DATABASE_ATTRIBUTES_INVALID')
  }
}

async function installLegacySchema(client) {
  const sql = await readFile(legacySchema, 'utf8')
  await inTransaction(client, async () => {
    await client.query('SET LOCAL search_path = public')
    await client.query(sql)
  })
}

async function ensureV2Installed(client) {
  const { rows } = await client.query(`
    SELECT nspname, obj_description(oid, 'pg_namespace') AS marker
    FROM pg_namespace WHERE nspname = ANY($1::text[])
  `, [schemas])
  if (rows.length === schemas.length
    && rows.some(row => row.nspname === 'ppt_web_state' && row.marker === installMarker)) return
  if (rows.length) throw new SetupError('4', 'INSTALL_STATE_UNKNOWN')

  await inTransaction(client, async () => {
    await client.query('SET ROLE ppt_owner')
    await installDatabase(client)
    await installWebState(client)
    await client.query('COMMENT ON SCHEMA ppt_web_state IS ' + pg.escapeLiteral(installMarker))
    await client.query('RESET ROLE')
  })
}

async function enableWebLogin(client, password) {
  await inTransaction(client, async () => {
    // 避免 PostgreSQL 將綁定值或巢狀 DDL 寫入標準伺服器紀錄。
    await client.query(`
      SET LOCAL log_statement = 'none';
      SET LOCAL log_parameter_max_length = 0;
      SET LOCAL log_parameter_max_length_on_error = 0;
      SET LOCAL log_min_error_statement = 'panic';
      SET LOCAL log_min_messages = 'panic';
      SET LOCAL password_encryption = 'scram-sha-256'
    `)
    await client.query("SELECT set_config('ppt_setup.web_password', $1, true)", [password])
    await client.query(`
      DO $$
      BEGIN
        EXECUTE format('ALTER ROLE ppt_web LOGIN PASSWORD %L',
                       current_setting('ppt_setup.web_password'));
      END;
      $$
    `)
  })
}

async function restrictConnect(client, database) {
  const identifier = pg.escapeIdentifier(database)
  await inTransaction(client, async () => {
    await client.query('REVOKE CONNECT, TEMPORARY ON DATABASE ' + identifier + ' FROM PUBLIC')
    await client.query('GRANT CONNECT ON DATABASE ' + identifier + ' TO ppt_web')
  })
}

async function prepareTarget(client, database, webPassword) {
  await atStep('3', 'LEGACY_SCHEMA_FAILED', () => installLegacySchema(client))
  await atStep('4', 'V2_INSTALL_FAILED', () => ensureV2Installed(client))
  await atStep('5', 'TEACHER_GRANT_FAILED', () => client.query(
    'GRANT SELECT (id, name, passcode_hash, created_at) ON public.teachers TO ppt_web',
  ))
  await atStep('6', 'PASSWORD_UPDATE_FAILED', () => enableWebLogin(client, webPassword))
  await atStep('7', 'DATABASE_GRANT_FAILED', () => restrictConnect(client, database))
}

export async function setupDatabase({ adminUrl, database = defaultDatabase, webPassword }) {
  checkDatabaseName(database)
  await atStep('1', 'ROLE_SETUP_FAILED', () => withClient(adminUrl, async admin => {
    // ensureRoles 會先收回 ppt_web 的 LOGIN，鎖涵蓋整次設定。
    await admin.query('SELECT pg_advisory_lock(609)')
    await ensureRoles(admin)
    await atStep('2', 'CREATE_DATABASE_FAILED', () => ensureDatabase(admin, database))
    await atStep('3', 'DATABASE_CONNECTION_FAILED', () => withClient(
      connectUrl(adminUrl, database), client => prepareTarget(client, database, webPassword),
    ))
  }))
}

async function main() {
  const { values } = parseArgs({ options: { database: { type: 'string' } } })
  const adminUrl = await readSecret('PPT_SETUP_ADMIN_URL_FILE')
  const webPassword = await readSecret('PPT_WEB_PASSWORD_FILE')
  await setupDatabase({ adminUrl, database: values.database, webPassword })
}

if (isEntryPoint(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof SetupError || error instanceof ConfigError ? error.message : 'SETUP_ARGUMENTS_INVALID')
    process.exitCode = 1
  }
}
