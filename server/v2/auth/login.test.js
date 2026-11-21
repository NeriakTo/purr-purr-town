import { adjustment } from '../../db-v2/test-support/operations.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { hashSessionToken } from './session.js'
import { createTestApp } from '../test-support/app.js'
import { postAuth, relayKey, relayHeaders } from '../test-support/auth-http.js'
import { openWebTestDatabase } from '../test-support/database.js'
import { createLegacyTeacher, createTestClass } from '../test-support/fixtures.js'
import { envelope, readOperation, sendOps } from '../test-support/ops.js'

const start = new Date('2026-11-21T08:00:00.000Z')
const day = 24 * 60 * 60 * 1000
const passcode = 'fake-teacher-test-passcode'

describe.skipIf(!process.env.PPT_TEST_DATABASE_URL)('老師登入', () => {
  let database
  let app
  let teacher

  beforeAll(async () => { database = await openWebTestDatabase() }, 15000)
  beforeEach(async () => {
    const { client } = database
    await client.query('TRUNCATE ppt_web_state.sessions, ppt_web_state.device_markers, public.teachers CASCADE')
    teacher = await createLegacyTeacher(client, { name: '測試老師甲', passcode })
    app = makeApp()
  })
  afterEach(async () => { await Promise.all(apps.splice(0).map(instance => instance.close())) })
  afterAll(async () => { await database?.close() }, 15000)

  const apps = []
  function makeApp(options = {}) {
    const instance = createTestApp(database, { config: { relayKey }, clock: () => start, ...options })
    apps.push(instance)
    return instance
  }

  async function storedState() {
    const { client } = database
    const { rows: sessions } = await client.query('SELECT * FROM ppt_web_state.sessions ORDER BY token_hash')
    const { rows: markers } = await client.query('SELECT * FROM ppt_web_state.device_markers ORDER BY marker_hash')
    return { sessions, markers }
  }

  async function login(instance = app, fields = {}, headers) {
    return postAuth(instance, 'login', { body: { name: teacher.name, passcode, ...fields }, headers })
  }

  test('登入以雜湊保存權杖與裝置標記，直連效期為 90 天', async () => {
    const response = await login()
    expect(response.statusCode).toBe(200)
    const { token, device_marker: marker } = response.json()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(marker).toMatch(/^[0-9a-f]{64}$/)
    expect(response.json()).toEqual({
      server_time: start.toISOString(), token, device_marker: marker,
      expires_at: new Date(start.getTime() + 90 * day).toISOString(),
      teacher: { id: teacher.id, name: teacher.name },
    })
    const state = await storedState()
    expect(state.sessions).toEqual([{
      token_hash: hashSessionToken(token), teacher_id: teacher.id, created_at: start,
      expires_at: new Date(start.getTime() + 90 * day), first_relayed_at: null,
    }])
    expect(state.markers).toEqual([{
      marker_hash: hashSessionToken(marker), teacher_id: teacher.id, created_at: start,
    }])
    expect(JSON.stringify(state)).not.toContain(token)
    expect(JSON.stringify(state)).not.toContain(marker)
  })

  test('登入權杖可提交 OP-24 且操作歸於舊表老師', async () => {
    const target = await createTestClass(database.client, { owner: { kind: 'teacher', id: teacher.id } })
    const { token } = (await login()).json()
    const op = adjustment(target)
    const response = await sendOps({ app, token }, envelope(target.classId, [op]))
    expect(response.statusCode).toBe(200)
    expect(response.json().receipts[0].status).toBe('committed')
    expect((await readOperation(database.client, op.op_id)).actor_id).toBe(teacher.id)
  })

  test('相同登入簽發兩個不同且都有效的權杖', async () => {
    const first = (await login()).json()
    const second = (await login()).json()
    expect(first.token).not.toBe(second.token)
    const target = await createTestClass(database.client, { owner: { kind: 'teacher', id: teacher.id } })
    for (const token of [first.token, second.token]) {
      const response = await sendOps({ app, token }, envelope(target.classId, [adjustment(target)]))
      expect(response.statusCode).toBe(200)
      expect(response.json().receipts[0].status).toBe('committed')
    }
  })

  test('登入沿用有效裝置標記且不新增標記列', async () => {
    const { device_marker: marker } = (await login()).json()
    const state = await storedState()
    const response = await login(app, { device_marker: marker })
    expect(response.statusCode).toBe(200)
    expect(response.json().device_marker).toBe(marker)
    expect((await storedState()).markers).toEqual(state.markers)
  })

  test('無帳號、錯密碼及重名回應逐位元組相同，無帳號仍比對一次', async () => {
    const { default: bcrypt } = await import('bcrypt')
    const verifyPassword = vi.fn((value, hash) => bcrypt.compare(value, hash))
    const instance = makeApp({ config: { login: { dummyHashCost: 4 } }, verifyPassword })
    const missing = await login(instance, { name: '測試老師不存在' })
    expect(verifyPassword).toHaveBeenCalledTimes(1)
    expect(verifyPassword).toHaveBeenCalledWith(passcode, expect.stringMatching(/^\$2[aby]\$04\$/))
    expect(await storedState()).toEqual({ sessions: [], markers: [] })
    const wrong = await login(instance, { passcode: 'fake-wrong-passcode' })
    expect(verifyPassword).toHaveBeenCalledTimes(2)
    expect(await storedState()).toEqual({ sessions: [], markers: [] })
    await createLegacyTeacher(database.client, { name: teacher.name, passcode })
    const duplicate = await login(instance)
    expect(verifyPassword).toHaveBeenCalledTimes(2)
    for (const response of [missing, wrong, duplicate]) {
      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('{"error":{"code":"LOGIN_FAILED"}}')
    }
    expect(await storedState()).toEqual({ sessions: [], markers: [] })
  })

  test('裝置標記不能代替密碼或當作提交權杖', async () => {
    const { device_marker: marker } = (await login()).json()
    const state = await storedState()
    const withoutPasscode = await login(app, { passcode: undefined, device_marker: marker })
    expect(withoutPasscode.statusCode).toBe(400)
    expect(withoutPasscode.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    expect(await storedState()).toEqual(state)
    const wrong = await login(app, { passcode: 'fake-wrong-passcode', device_marker: marker })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual({ error: { code: 'LOGIN_FAILED' } })
    expect(await storedState()).toEqual(state)
    const target = await createTestClass(database.client, { owner: { kind: 'teacher', id: teacher.id } })
    const op = adjustment(target)
    const ops = await sendOps({ app, token: marker }, envelope(target.classId, [op]))
    expect(ops.statusCode).toBe(401)
    expect(ops.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } })
    expect(await readOperation(database.client, op.op_id)).toBeUndefined()
  })

  test('別位老師帶裝置標記會取得新標記，原標記仍歸原老師', async () => {
    const { device_marker: marker } = (await login()).json()
    const other = await createLegacyTeacher(database.client, { name: '測試老師乙', passcode })
    const response = await login(app, { name: other.name, device_marker: marker })
    expect(response.statusCode).toBe(200)
    const newMarker = response.json().device_marker
    expect(newMarker).not.toBe(marker)
    expect((await storedState()).markers).toEqual(expect.arrayContaining([
      { marker_hash: hashSessionToken(marker), teacher_id: teacher.id, created_at: start },
      { marker_hash: hashSessionToken(newMarker), teacher_id: other.id, created_at: start },
    ]))
    expect((await storedState()).markers).toHaveLength(2)
  })

  test.each([
    ['格式錯誤', 'A'.repeat(64), true],
    ['結尾換行', 'a'.repeat(63) + '\n', true],
    ['長度超過', 'a'.repeat(65), true],
    ['查無標記', 'a'.repeat(64), false],
  ])('%s的裝置標記視同沒帶', async (_label, marker, seed) => {
    if (seed) await database.client.query(`
      INSERT INTO ppt_web_state.device_markers (marker_hash, teacher_id, created_at) VALUES ($1, $2, $3)
    `, [hashSessionToken(marker), teacher.id, start])
    const originalHashes = (await storedState()).markers.map(row => row.marker_hash)
    const response = await login(app, { device_marker: marker })
    expect(response.statusCode).toBe(200)
    const actual = response.json().device_marker
    expect(actual).not.toBe(marker)
    expect((await storedState()).markers.map(row => row.marker_hash)).toEqual([...originalHashes, hashSessionToken(actual)].sort())
  })

  test.each([
    ['陣列', []],
    ['空值', null],
    ['名稱不是字串', { name: 1, passcode }],
    ['沒有名稱', { name: '', passcode }],
    ['名稱超過 50 字', { name: '測'.repeat(51), passcode }],
    ['密碼不是字串', { name: '測試老師甲', passcode: 1 }],
    ['沒有密碼', { name: '測試老師甲', passcode: '' }],
    ['本文超過 4 KiB', { name: '測試老師甲', passcode, extra: '測'.repeat(1400) }],
  ])('%s回 400 且沒有工作階段或裝置標記', async (_label, body) => {
    const response = await postAuth(app, 'login', { body })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'BAD_ENVELOPE' } })
    expect(await storedState()).toEqual({ sessions: [], markers: [] })
  })

  test('正確 GAS 轉送識別使簽發的權杖在 24 小時到期', async () => {
    const response = await login(app, {}, relayHeaders)
    expect(response.statusCode).toBe(200)
    expect(response.json().expires_at).toBe(new Date(start.getTime() + day).toISOString())
    const { sessions } = await storedState()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].first_relayed_at).toEqual(start)
    expect(sessions[0].expires_at).toEqual(new Date(start.getTime() + 90 * day))
  })

  test.each([
    ['標頭錯誤', { relayKey }, { 'x-ppt-relay-key': relayKey.slice(0, -1) + '1' }],
    ['密鑰沒設', {}, relayHeaders],
    ['密鑰為 null', { relayKey: null }, relayHeaders],
    ['標頭與密鑰為空字串', { relayKey: '' }, { 'x-ppt-relay-key': '' }],
    ['只有轉送位址標頭', { relayKey }, { 'x-forwarded-for': '198.51.100.7' }],
  ])('%s以直連簽發', async (_label, config, headers) => {
    const response = await login(makeApp({ config }), {}, headers)
    expect(response.statusCode).toBe(200)
    expect(response.json().expires_at).toBe(new Date(start.getTime() + 90 * day).toISOString())
    const { sessions } = await storedState()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].first_relayed_at).toBeNull()
  })
})
