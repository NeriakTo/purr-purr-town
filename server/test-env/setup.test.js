import pg from 'pg'
import { expect, test } from 'vitest'
import { ensureRoles } from '../db-v2/roles.js'
import { adminUrl, withTestCluster, withTestDatabase } from './database-fixture.js'
import { setupDatabase } from './setup.js'

const databaseTest = test.skipIf(!adminUrl)

databaseTest('從空叢集安裝舊表及兩套新版 schema 並完成登入授權', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    await withTestDatabase(options.database, async db => {
      const { rows: [state] } = await db.query(`
        SELECT to_regclass('public.teachers') IS NOT NULL AS teachers,
               to_regclass('ppt.classes') IS NOT NULL AS classes,
               to_regclass('ppt_web_state.sessions') IS NOT NULL AS sessions,
               has_database_privilege('ppt_web', current_database(), 'CONNECT') AS connect,
               has_database_privilege('ppt_web', current_database(), 'TEMP') AS temp,
               has_column_privilege('ppt_web', 'public.teachers', 'created_at', 'SELECT') AS created_at,
               (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'ppt_web') AS login
      `)
      expect(state).toEqual({
        teachers: true, classes: true, sessions: true, connect: true,
        temp: false, created_at: true, login: true,
      })
    })
  })
}, 30_000)

databaseTest('重跑保留第一次寫入的新版資料', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    await withTestDatabase(options.database, async db => {
      await db.query("CREATE TABLE ppt.setup_test_probe (id integer); INSERT INTO ppt.setup_test_probe VALUES (42)")
    })
    await setupDatabase(options)
    await withTestDatabase(options.database, async db => {
      const { rows } = await db.query('SELECT id FROM ppt.setup_test_probe')
      expect(rows).toEqual([{ id: 42 }])
    })
  })
}, 30_000)

databaseTest('既有資料庫語系不符時在第 2 步停止', async () => {
  await withTestCluster(async options => {
    const { admin, database } = options
    await ensureRoles(admin)
    await admin.query("CREATE DATABASE " + pg.escapeIdentifier(database)
      + " OWNER ppt_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'")
    await expect(setupDatabase(options)).rejects.toMatchObject({
      step: '2', message: '步驟 2 DATABASE_ATTRIBUTES_INVALID',
    })
    await withTestDatabase(database, async db => {
      const { rows: [state] } = await db.query("SELECT to_regclass('public.teachers') AS teachers")
      expect(state.teachers).toBeNull()
    })
  })
}, 30_000)

databaseTest('第 6 步失敗只回傳錯誤碼與 SQLSTATE', async () => {
  await withTestCluster(async options => {
    const invalidPassword = options.webPassword + '\0'
    await expect(setupDatabase({ ...options, webPassword: invalidPassword })).rejects.toThrow(
      /^步驟 6 PASSWORD_UPDATE_FAILED [0-9A-Z]{5}$/,
    )
  })
}, 30_000)
