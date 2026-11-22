import pg from 'pg'
import { expect, test } from 'vitest'
import { buildV2App } from '../v2/app.js'
import { adminUrl, testPassword, withTestCluster, withTestDatabase } from './database-fixture.js'
import { setupDatabase } from './setup.js'
import { runSmoke } from './smoke.js'
import { buildDatabaseUrl } from './start-api.js'

const databaseTest = test.skipIf(!adminUrl)

async function withSmokeApp(work) {
  await withTestCluster(async options => {
    const name = '冒煙測試老師'
    await setupDatabase({ ...options, teacherName: name })
    const base = new URL(options.adminUrl)
    base.username = 'ppt_web'
    base.password = ''
    base.pathname = '/' + options.database
    const pool = new pg.Pool({ connectionString: buildDatabaseUrl(base.href, options.webPassword) })
    const app = buildV2App({ pool })
    const logs = []
    const requests = []
    async function send(method, url, { headers, body }) {
      requests.push(url)
      const reply = await app.inject({ method, url, headers, payload: body })
      return { status: reply.statusCode, json: reply.json() }
    }
    try {
      const smoke = { send, name, passcode: options.demoPassword, log: line => logs.push(line) }
      await work({ smoke, logs, requests, database: options.database })
    } finally {
      await app.close()
      await pool.end()
    }
  })
}

databaseTest('網站帳號以 app.inject 跑完 11 步且再次執行可建獨立假班', async () => {
  await withSmokeApp(async ({ smoke, logs, database }) => {
    await runSmoke(smoke)
    await runSmoke(smoke)
    expect(logs).toHaveLength(22)
    for (let i = 0; i < logs.length; i++) {
      expect(logs[i]).toMatch(new RegExp('^步驟 ' + (i % 11 + 1) + ' .+ 通過$'))
    }
    await withTestDatabase(database, async db => {
      const { rows } = await db.query(`
        SELECT c.class_id, c.name, array_agg(s.name ORDER BY s.seat_number) AS students
        FROM ppt.classes c JOIN ppt.students s USING (class_id)
        GROUP BY c.class_id
      `)
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.name).toBe('smoke-' + row.class_id)
        expect(row.students).toEqual(['測試甲', '測試乙', '測試丙'])
      }
    })
  })
}, 30_000)

databaseTest('示範老師密碼錯誤時停在第 2 步且不輸出回應', async () => {
  await withSmokeApp(async ({ smoke, logs, requests }) => {
    await expect(runSmoke({ ...smoke, passcode: testPassword() })).rejects.toMatchObject({ step: 2 })
    expect(requests).toEqual(['/api/v2/read/classes', '/api/v2/auth/login'])
    expect(logs).toEqual(['步驟 1 未登入拒絕 通過', '步驟 2 登入 失敗'])
  })
}, 30_000)

databaseTest('整班讀取的餘額錯誤時停在第 8 步且不放棄或查詢', async () => {
  await withSmokeApp(async ({ smoke, logs, requests }) => {
    async function withWrongBalance(method, path, input) {
      const response = await smoke.send(method, path, input)
      if (path === '/api/v2/read/state') {
        for (const row of response.json.rows.filter(item => item.entity === 'account')) row.value.balance = 0
      }
      return response
    }
    await expect(runSmoke({ ...smoke, send: withWrongBalance })).rejects.toMatchObject({ step: 8 })
    expect(requests.at(-1)).toBe('/api/v2/read/state')
    expect(requests).toHaveLength(8)
    expect(logs).toHaveLength(8)
    expect(logs.at(-1)).toBe('步驟 8 讀取班級與餘額 失敗')
  })
}, 30_000)
