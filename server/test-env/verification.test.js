import pg from 'pg'
import bcrypt from 'bcrypt'
import { expect, test } from 'vitest'
import { comparePassword } from '../v2/auth/password.js'
import { adminUrl, testPassword, withTestCluster, withTestDatabase } from './database-fixture.js'
import { getStatus, setupDatabase, verifyDatabase } from './setup.js'

const databaseTest = test.skipIf(!adminUrl)

databaseTest('8.1 拒絕語系不符的資料庫', async () => {
  await withTestCluster(async options => {
    await options.admin.query("CREATE DATABASE " + pg.escapeIdentifier(options.database)
      + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'")
    await expect(verifyDatabase(options)).rejects.toThrow('步驟 8.1 LOCALE_INVALID')
  })
}, 30_000)

async function expectBrokenVerification(alter, message) {
  await withTestCluster(async options => {
    await setupDatabase(options)
    await withTestDatabase(options.database, alter)
    await expect(verifyDatabase(options)).rejects.toThrow(message)
  })
}

databaseTest('8.2 ppt_web 無法登入時失敗', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    await options.admin.query('ALTER ROLE ppt_web NOLOGIN')
    try {
      await expect(verifyDatabase(options)).rejects.toThrow('步驟 8.2 WEB_LOGIN_FAILED')
    } finally {
      await options.admin.query('ALTER ROLE ppt_web LOGIN')
    }
  })
}, 30_000)

databaseTest('8.3 ppt_web 能直接 INSERT 時失敗', async () => {
  await expectBrokenVerification(
    db => db.query('GRANT INSERT ON ppt.classes TO ppt_web'),
    '步驟 8.3 PPT_INSERT_NOT_DENIED',
  )
}, 30_000)

databaseTest('8.4 ppt_web 無法讀 passcode_hash 時失敗', async () => {
  await expectBrokenVerification(
    db => db.query('REVOKE SELECT (passcode_hash) ON public.teachers FROM ppt_web'),
    '步驟 8.4 TEACHER_HASH_READ_FAILED 42501',
  )
}, 30_000)

databaseTest('8.5 ppt_web 能讀未授權欄位時失敗', async () => {
  await expectBrokenVerification(
    db => db.query('GRANT SELECT (updated_at) ON public.teachers TO ppt_web'),
    '步驟 8.5 TEACHER_COLUMN_NOT_DENIED',
  )
}, 30_000)

databaseTest('8.6 公開 CONNECT 時失敗且移除臨時角色', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    const { admin, database } = options
    const probeRoles = "SELECT rolname FROM pg_roles WHERE rolname LIKE 'ppt_setup_probe_%' ORDER BY rolname"
    const before = (await admin.query(probeRoles)).rows
    await admin.query('GRANT CONNECT ON DATABASE ' + pg.escapeIdentifier(database) + ' TO PUBLIC')
    await expect(verifyDatabase(options)).rejects.toThrow('步驟 8.6 PUBLIC_CONNECT_NOT_DENIED')
    expect((await admin.query(probeRoles)).rows).toEqual(before)
  })
}, 30_000)

databaseTest.each(['ppt_owner', 'ppt_agent', 'ppt_backup'])('8.7 %s 被改為 LOGIN 時失敗', async role => {
  await withTestCluster(async options => {
    const { admin } = options
    await setupDatabase(options)
    await admin.query('ALTER ROLE ' + pg.escapeIdentifier(role) + ' LOGIN')
    try {
      await expect(verifyDatabase(options)).rejects.toThrow('步驟 8.7 ROLE_CAN_LOGIN ' + role.toUpperCase())
    } finally {
      await admin.query('ALTER ROLE ' + pg.escapeIdentifier(role) + ' NOLOGIN')
    }
  })
}, 30_000)

databaseTest('示範老師使用成本 10 的 bcrypt 且重跑會更新雜湊', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    const newPassword = testPassword()
    await setupDatabase({ ...options, demoPassword: newPassword })
    await withTestDatabase(options.database, async db => {
      const { rows } = await db.query('SELECT id, name, passcode_hash FROM public.teachers')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: options.teacherId, name: 'demo-teacher' })
      expect(bcrypt.getRounds(rows[0].passcode_hash)).toBe(10)
      expect(await comparePassword(newPassword, rows[0].passcode_hash)).toBe(true)
      expect(await comparePassword(options.demoPassword, rows[0].passcode_hash)).toBe(false)
    })
  })
}, 30_000)

databaseTest('status 依序輸出兩表列數與位元組數', async () => {
  await withTestCluster(async options => {
    await setupDatabase(options)
    await withTestDatabase(options.database, async db => {
      await db.query(`
        INSERT INTO ppt_web_state.login_buckets (bucket_key) VALUES (repeat('a', 64));
        INSERT INTO ppt_web_state.device_markers VALUES
          (repeat('b', 64), 'demo-teacher', now()), (repeat('c', 64), 'demo-teacher', now())
      `)
      const { rows: [row] } = await db.query('SELECT pg_database_size(current_database())::text AS bytes')
      expect(await getStatus(options)).toEqual(['1', '2', row.bytes])
    })
  })
}, 30_000)
