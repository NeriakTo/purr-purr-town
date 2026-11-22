import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import bcrypt from 'bcrypt'
import pg from 'pg'
import { ensureRoles } from '../db-v2/roles.js'
import { install as installDatabase } from '../db-v2/install.js'
import { install as installWebState } from '../v2/install.js'
import { ConfigError, isEntryPoint, readSecret } from './secrets.js'

const defaultDatabase = 'ppt_test'
const defaultTeacherName = 'demo-teacher'
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

async function setLoginPassword(client, role, password) {
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
    await client.query(`
      SELECT set_config('ppt_setup.login_role', $1, true),
             set_config('ppt_setup.login_password', $2, true)
    `, [role, password])
    await client.query(`
      DO $$
      BEGIN
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L',
                       current_setting('ppt_setup.login_role'),
                       current_setting('ppt_setup.login_password'));
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
  await atStep('6', 'PASSWORD_UPDATE_FAILED', () => setLoginPassword(client, 'ppt_web', webPassword))
  await atStep('7', 'DATABASE_GRANT_FAILED', () => restrictConnect(client, database))
}

function roleUrl(adminUrl, database, role, password) {
  const url = connectUrl(adminUrl, database)
  url.searchParams.delete('user')
  url.searchParams.delete('password')
  url.searchParams.delete('options')
  url.username = role
  url.password = encodeURIComponent(password)
  return url
}

async function expectDenied(step, code, work) {
  try {
    await work()
  } catch (error) {
    if (error.code === '42501') return
    throw new SetupError(step, code, error)
  }
  throw new SetupError(step, code)
}

async function verifyWebPermissions(client) {
  const { rows: [identity] } = await client.query('SELECT current_user')
  if (identity.current_user !== 'ppt_web') throw new SetupError('8.2', 'WEB_IDENTITY_INVALID')

  // 零列 INSERT 仍檢查權限，意外授權時也不會新增資料。
  await expectDenied('8.3', 'PPT_INSERT_NOT_DENIED', () => client.query(
    'INSERT INTO ppt.classes (class_id) SELECT NULL::text WHERE false',
  ))
  await atStep('8.4', 'TEACHER_HASH_READ_FAILED', () => client.query(
    'SELECT passcode_hash FROM public.teachers LIMIT 1',
  ))
  await expectDenied('8.5', 'TEACHER_COLUMN_NOT_DENIED', () => client.query(
    'SELECT updated_at FROM public.teachers LIMIT 1',
  ))
}

async function verifyPublicConnect(client, adminUrl, database) {
  const role = 'ppt_setup_probe_' + randomBytes(12).toString('hex')
  const password = randomBytes(24).toString('hex')
  const identifier = pg.escapeIdentifier(role)
  await client.query('CREATE ROLE ' + identifier)
  try {
    await setLoginPassword(client, role, password)
    await expectDenied('8.6', 'PUBLIC_CONNECT_NOT_DENIED', () => withClient(
      roleUrl(adminUrl, database, role, password), db => db.query('SELECT 1'),
    ))
  } finally {
    await client.query('DROP ROLE ' + identifier)
  }
}

async function verifyNonLoginRoles(client) {
  const roles = ['ppt_owner', 'ppt_agent', 'ppt_backup']
  const { rows } = await client.query(
    'SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])', [roles],
  )
  for (const role of roles) {
    if (rows.find(row => row.rolname === role)?.rolcanlogin !== false) {
      throw new SetupError('8.7', 'ROLE_CAN_LOGIN ' + role.toUpperCase())
    }
  }
}

async function verifyTarget(client, { adminUrl, database, webPassword }) {
  await atStep('8.1', 'LOCALE_INVALID', async () => {
    if (!hasExpectedLocale(await databaseAttributes(client, database))) {
      throw new SetupError('8.1', 'LOCALE_INVALID')
    }
  })
  await atStep('8.2', 'WEB_LOGIN_FAILED', () => withClient(
    roleUrl(adminUrl, database, 'ppt_web', webPassword), verifyWebPermissions,
  ))
  await atStep('8.6', 'PUBLIC_CONNECT_PROBE_FAILED', () => verifyPublicConnect(client, adminUrl, database))
  await atStep('8.7', 'ROLE_CHECK_FAILED', () => verifyNonLoginRoles(client))
}

export async function verifyDatabase({ adminUrl, database = defaultDatabase, webPassword }) {
  await atStep('8', 'VERIFICATION_CONNECTION_FAILED', () => withClient(
    connectUrl(adminUrl, database), client => verifyTarget(client, { adminUrl, database, webPassword }),
  ))
}

async function seedDemoTeacher(client, { teacherId, teacherName, demoPassword }) {
  if (typeof teacherId !== 'string' || !teacherId || typeof teacherName !== 'string'
    || !teacherName || teacherName.length > 50 || typeof demoPassword !== 'string'
    || !demoPassword || Buffer.byteLength(demoPassword) > 72) {
    throw new SetupError('9', 'DEMO_TEACHER_ARGUMENTS_INVALID')
  }
  const hash = await bcrypt.hash(demoPassword, 10)
  const { rowCount } = await client.query(`
    INSERT INTO public.teachers (id, name, passcode_hash)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (SELECT 1 FROM public.teachers WHERE name = $2 AND id <> $1)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, passcode_hash = EXCLUDED.passcode_hash, updated_at = now()
  `, [teacherId, teacherName, hash])
  if (rowCount !== 1) throw new SetupError('9', 'DEMO_TEACHER_NAME_IN_USE')
}

export async function setupDatabase({
  adminUrl, database = defaultDatabase, webPassword,
  teacherId, teacherName = defaultTeacherName, demoPassword,
}) {
  checkDatabaseName(database)
  await atStep('1', 'ROLE_SETUP_FAILED', () => withClient(adminUrl, async admin => {
    // ensureRoles 會先收回 ppt_web 的 LOGIN，鎖涵蓋整次設定。
    await admin.query('SELECT pg_advisory_lock(609)')
    await ensureRoles(admin)
    await atStep('2', 'CREATE_DATABASE_FAILED', () => ensureDatabase(admin, database))
    await atStep('3', 'DATABASE_CONNECTION_FAILED', () => withClient(
      connectUrl(adminUrl, database), async client => {
        await prepareTarget(client, database, webPassword)
        await verifyTarget(client, { adminUrl, database, webPassword })
        await atStep('9', 'DEMO_TEACHER_FAILED', () => seedDemoTeacher(client, { teacherId, teacherName, demoPassword }))
      },
    ))
  }))
}

export async function getStatus({ adminUrl, database = defaultDatabase }) {
  return atStep('status', 'STATUS_FAILED', () => withClient(connectUrl(adminUrl, database), async client => {
    const { rows: [row] } = await client.query(`
      SELECT (SELECT count(*) FROM ppt_web_state.login_buckets)::text AS login_buckets,
             (SELECT count(*) FROM ppt_web_state.device_markers)::text AS device_markers,
             pg_database_size(current_database())::text AS bytes
    `)
    return [row.login_buckets, row.device_markers, row.bytes]
  }))
}

async function main() {
  let args
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        database: { type: 'string' },
        'teacher-id': { type: 'string' },
        'teacher-name': { type: 'string' },
      },
    })
  } catch {
    throw new ConfigError('SETUP_ARGUMENTS_INVALID')
  }
  const { values, positionals } = args
  if (positionals.length > 1 || (positionals.length && positionals[0] !== 'status')) {
    throw new ConfigError('SETUP_ARGUMENTS_INVALID')
  }
  const adminUrl = await readSecret('PPT_SETUP_ADMIN_URL_FILE')
  const database = values.database
  if (positionals[0] === 'status') {
    const counts = await getStatus({ adminUrl, database })
    console.log(counts.join('\n'))
    return
  }
  if (!values['teacher-id']) throw new ConfigError('SETUP_TEACHER_ID_REQUIRED')
  const webPassword = await readSecret('PPT_WEB_PASSWORD_FILE')
  const demoPassword = await readSecret('PPT_DEMO_TEACHER_PASSWORD_FILE')
  await setupDatabase({
    adminUrl, database, webPassword, demoPassword,
    teacherId: values['teacher-id'], teacherName: values['teacher-name'],
  })
}

export async function runCli(work, { stderr = console.error } = {}) {
  try {
    await work()
    return 0
  } catch (error) {
    stderr(error instanceof SetupError || error instanceof ConfigError ? error.message : 'SETUP_FAILED')
    return 1
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runCli(main)
}
