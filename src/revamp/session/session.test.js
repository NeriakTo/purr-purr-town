import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createOperations, getDeviceSetting, getLocalLogin, listOperations, openQueueDatabase,
  runStorageTransaction, saveDeviceSetting, saveLocalLogin,
} from '../storage/queue-storage.js'
import { createTransport } from '../net/transport.js'
import {
  createIndexedDbRelayPassStore, getLocalSessionState, login, markSessionRequiresLogin,
  querySession, trackRelaySession,
} from './session.js'

const name = '測試用登入名稱'
const passcode = '測試用假密碼'
const token = 'ab'.repeat(32)
const marker = 'cd'.repeat(32)
const markerKey = 'device_marker:' + name
const relayPass = '測試用假通行碼'
const teacher = { id: '測試用帳號', name: '測試用顯示名稱' }
const loginPath = '/api/v2/auth/login'
const sessionPath = '/api/v2/auth/session'
const initialTime = Date.parse('2026-01-02T03:04:05Z')
const day = 86_400_000
const iso = time => new Date(time).toISOString()
const sessionBody = { server_time: iso(initialTime), teacher, expires_at: iso(initialTime + 90 * day) }
const loginBody = { ...sessionBody, token, device_marker: marker }
const loginRecord = {
  accountId: teacher.id, teacherName: teacher.name, token, expiresAt: loginBody.expires_at,
  loginVia: 'direct', firstRelayedAt: null, requiresLogin: false, loggedInAt: initialTime,
}
const priorRecord = { ...loginRecord, accountId: '另一個測試用帳號', token: 'cf'.repeat(32) }
const http = (status, body, via = 'direct') => ({ kind: 'http', status, via, bodyText: JSON.stringify(body) })
const ok = (body = loginBody, via = 'direct') => http(200, body, via)
const error = (status, code, fields) => http(status, { error: { code, ...fields } })
const gasError = code => ({ kind: 'gas_error', via: 'gas', code })
const lost = (via = 'direct', reason = 'fetch_failed') => ({ kind: 'lost', via, reason })

let db
let factory
let time
let transport
const clock = { now: () => time }
const signIn = (credentials = { name, passcode }) => login({ db, transport, clock }, credentials)
const checkSession = () => querySession({ db, transport, clock })

async function expectEmptyLogin() {
  expect(await getLocalLogin(db)).toBeUndefined()
  const settings = await runStorageTransaction(db, 'deviceSettings', 'readonly', tx =>
    new Promise((resolve, reject) => {
      const request = tx.objectStore('deviceSettings').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }),
  )
  expect(settings).toEqual([])
}

beforeEach(async () => {
  factory = new IDBFactory()
  db = await openQueueDatabase({ factory })
  time = initialTime
  transport = { send: vi.fn().mockResolvedValue(ok()), getRememberedRoute: vi.fn() }
})

afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

it('登入逐字保存權杖與帳號，成功回傳不含憑證', async () => {
  expect(await signIn()).toEqual({ kind: 'success', accountId: teacher.id, teacherName: teacher.name })
  expect(transport.send.mock.calls).toEqual([[{ path: loginPath, bodyText: JSON.stringify({ name, passcode }) }]])
  expect(await getLocalLogin(db)).toEqual(loginRecord)
})

it('裝置標記重開連線後只隨相同登入名稱送出', async () => {
  await signIn()
  expect(JSON.parse(transport.send.mock.calls[0][0].bodyText)).not.toHaveProperty('device_marker')
  db.close()
  db = await openQueueDatabase({ factory })
  await signIn()
  expect(JSON.parse(transport.send.mock.calls[1][0].bodyText)).toHaveProperty('device_marker', marker)
  await signIn({ name: '另一個測試用登入名稱', passcode })
  expect(JSON.parse(transport.send.mock.calls[2][0].bodyText)).not.toHaveProperty('device_marker')
})

it('寫完裝置標記後交易中止時，登入紀錄與標記一起回滾', async () => {
  await saveLocalLogin(db, priorRecord)
  const transaction = db.transaction.bind(db)
  vi.spyOn(db, 'transaction').mockImplementation((...args) => {
    const tx = transaction(...args)
    if (args[1] !== 'readwrite') return tx
    const objectStore = tx.objectStore.bind(tx)
    vi.spyOn(tx, 'objectStore').mockImplementation(storeName => {
      const store = objectStore(storeName)
      if (storeName === 'deviceSettings') {
        const put = store.put.bind(store)
        vi.spyOn(store, 'put').mockImplementation((...fields) => {
          const request = put(...fields)
          request.addEventListener('success', () => tx.abort(), { once: true })
          return request
        })
      }
      return store
    })
    return tx
  })
  expect(await signIn()).toEqual({ kind: 'storage_error' })
  expect(await getLocalLogin(db)).toEqual(priorRecord)
  expect(await getDeviceSetting(db, markerKey)).toBeUndefined()
})

it('登入失敗與離線保留另一個帳號的紀錄、標記及待送項目', async () => {
  await saveLocalLogin(db, priorRecord)
  await saveDeviceSetting(db, markerKey, marker)
  const scope = { accountId: priorRecord.accountId, classId: '測試用班級' }
  const pending = await createOperations(db, scope, [{ type: 'class.create', payload: {} }])
  transport.send.mockResolvedValueOnce(error(401, 'LOGIN_FAILED')).mockResolvedValueOnce(lost())
  expect(await signIn()).toEqual({ kind: 'login_failed' })
  expect(await signIn()).toEqual({ kind: 'unreachable' })
  expect(await getLocalLogin(db)).toEqual(priorRecord)
  expect(await getDeviceSetting(db, markerKey)).toBe(marker)
  expect(await listOperations(db, scope)).toEqual(pending)
})

it.each([
  ['登入桶忙碌', { retry_after: 30, reason: 'bucket_busy' }, 'bucket_busy',
    '有人正在嘗試這個帳號的密碼。請先用登入過的裝置。這台電腦一定要登入時，請通知維護者'],
  ['一般限流', { retry_after: 5 }, 'rate_limited', '目前登入的請求很多，請過幾秒再試。登入過的裝置不受影響'],
])('%s回規格文字與等待秒數', async (_label, fields, kind, message) => {
  transport.send.mockResolvedValue(error(429, 'RATE_LIMITED', fields))
  expect(await signIn()).toEqual({ kind, message, retry_after: fields.retry_after })
  expect(transport.send).toHaveBeenCalledTimes(1)
  await expectEmptyLogin()
})

it.each([
  ['缺少權杖', { token: undefined }],
  ['權杖含大寫', { token: token.toUpperCase() }],
  ['老師編號不是字串', { teacher: { ...teacher, id: 1 } }],
  ['老師編號為空', { teacher: { ...teacher, id: '' } }],
  ['標記含大寫', { device_marker: marker.toUpperCase() }],
  ['到期時間不是字串', { expires_at: initialTime }],
])('登入回應%s時不儲存', async (_label, patch) => {
  transport.send.mockResolvedValue(ok({ ...loginBody, ...patch }))
  expect(await signIn()).toEqual({ kind: 'invalid_response' })
  await expectEmptyLogin()
})

it.each([
  ['回應遺失', lost(), { kind: 'unreachable' }],
  ['轉送連不到後端', gasError('UPSTREAM_UNREACHABLE'), { kind: 'unreachable' }],
  ['缺少轉送通行碼', gasError('RELAY_FORBIDDEN'), { kind: 'relay_pass_required' }],
  ['伺服器忙碌', error(503, 'SERVER_BUSY'), { kind: 'server_error', code: 'SERVER_BUSY' }],
  ['伺服器內部錯誤', error(500, 'INTERNAL_ERROR'), { kind: 'server_error', code: 'INTERNAL_ERROR' }],
  ['來源被拒', error(403, 'ORIGIN_FORBIDDEN'), { kind: 'server_error', code: 'ORIGIN_FORBIDDEN' }],
  ['後端拒絕本文', error(400, 'BAD_ENVELOPE'), { kind: 'bad_envelope', code: 'BAD_ENVELOPE' }],
  ['轉送拒絕包裝', gasError('BAD_ENVELOPE'), { kind: 'bad_envelope', code: 'BAD_ENVELOPE' }],
  ['本文不是 JSON', { ...ok(), bodyText: '測試用非 JSON 回應' }, { kind: 'invalid_response' }],
])('%s時整理結果且不儲存', async (_label, response, expected) => {
  transport.send.mockResolvedValue(response)
  expect(await signIn()).toEqual(expected)
  await expectEmptyLogin()
})

it.each([
  ['名稱為空', { name: '' }],
  ['名稱過長', { name: '甲'.repeat(51) }],
  ['名稱超過五十個 UTF-16 碼元', { name: '🐾'.repeat(26) }],
  ['密碼為空', { passcode: '' }],
  ['UTF-8 本文超過上限', { passcode: '假'.repeat(1400) }],
])('%s時不送出請求', async (_label, patch) => {
  expect(await signIn({ name, passcode, ...patch })).toEqual({ kind: 'invalid_input' })
  expect(transport.send).not.toHaveBeenCalled()
})

it('接受 4 KiB 的本文，加上既存裝置標記後超過上限就不送', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ name, passcode: '' })).length
  const credentials = { name, passcode: 'x'.repeat(4096 - bytes) }
  expect(await signIn(credentials)).toMatchObject({ kind: 'success' })
  expect(await signIn(credentials)).toEqual({ kind: 'invalid_input' })
  expect(transport.send).toHaveBeenCalledTimes(1)
})

it('回傳值與錯誤不洩漏密碼或權杖，密碼未儲存', async () => {
  const results = [await signIn()]
  transport.send.mockResolvedValueOnce(error(500, token + passcode))
    .mockResolvedValueOnce({ ...ok(), bodyText: token + passcode })
    .mockRejectedValueOnce(new Error(token + passcode))
  results.push(await signIn(), await signIn(), await signIn())
  expect(await getLocalLogin(db)).toEqual(loginRecord)
  expect(JSON.stringify(await getLocalLogin(db))).not.toContain(passcode)
  expect(await getDeviceSetting(db, markerKey)).toBe(marker)
  db.close()
  results.push(await signIn())
  try {
    await createIndexedDbRelayPassStore({ db }).read()
  } catch (error) {
    results.push(String(error))
  }
  for (const result of results) {
    const text = JSON.stringify(result)
    expect(text).not.toContain(passcode)
    expect(text).not.toContain(token)
  }
})

it('首次登入前禁止建班待送項目，登入後即使需重登入仍可建立', async () => {
  const scope = { accountId: teacher.id, classId: '00000000-0000-4000-8000-000000000001' }
  const inputs = [{ type: 'class.create', payload: { class_id: scope.classId, name: '測試用班級' } }]
  await expect(createOperations(db, scope, inputs)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
  expect(await listOperations(db, scope)).toEqual([])
  await signIn()
  expect(await createOperations(db, scope, inputs)).toMatchObject([{ accountId: teacher.id }])
  await markSessionRequiresLogin({ db }, token)
  expect(await getLocalLogin(db)).toMatchObject({ requiresLogin: true })
  expect(await createOperations(db, scope, inputs)).toMatchObject([{ accountId: teacher.id }])
})

it('只記第一次帶權杖經 GAS 的時間，原請求與回傳維持原樣', async () => {
  await saveLocalLogin(db, loginRecord)
  const response = ok(sessionBody, 'gas')
  transport.send.mockResolvedValue(response)
  const wrapped = trackRelaySession({ db, transport, clock })
  const request = { path: sessionPath, token, bodyText: '{}' }
  expect(wrapped.getRememberedRoute).toBe(transport.getRememberedRoute)
  expect(await wrapped.send(request)).toBe(response)
  expect(transport.send.mock.calls[0][0]).toBe(request)
  expect(await getLocalLogin(db)).toEqual({ ...loginRecord, firstRelayedAt: initialTime })
  time += day
  await wrapped.send(request)
  const record = await getLocalLogin(db)
  expect(record.firstRelayedAt).toBe(initialTime)
  expect(getLocalSessionState(record, time)).toBe('expired')
})

it('GAS 之後改直連的結果仍記首次時間', async () => {
  await saveLocalLogin(db, loginRecord)
  const response = { ...ok(sessionBody), attemptedGas: true }
  transport.send.mockResolvedValue(response)
  const wrapped = trackRelaySession({ db, transport, clock })
  expect(await wrapped.send({ path: sessionPath, token, bodyText: '{}' })).toBe(response)
  expect(await getLocalLogin(db)).toMatchObject({ firstRelayedAt: initialTime })
})

it.each([
  ['只走直連', token, ok(sessionBody)],
  ['請求未帶權杖', undefined, ok(sessionBody, 'gas')],
  ['路徑無效', token, lost('gas', 'invalid_path')],
  ['請求無效', token, lost('gas', 'invalid_request')],
  ['網址無效', token, lost('gas', 'invalid_url')],
  ['通行碼讀取失敗', token, lost('gas', 'relay_pass_failed')],
])('%s時不記 GAS 時間', async (_label, sentToken, response) => {
  await saveLocalLogin(db, loginRecord)
  transport.send.mockResolvedValue(response)
  const wrapped = trackRelaySession({ db, transport, clock })
  expect(await wrapped.send({ path: sessionPath, token: sentToken, bodyText: '{}' })).toBe(response)
  expect(await getLocalLogin(db)).toEqual(loginRecord)
})

it('GAS 回來前換了權杖就不改紀錄，儲存失敗也照回原結果', async () => {
  await saveLocalLogin(db, loginRecord)
  const response = ok(sessionBody, 'gas')
  transport.send.mockImplementationOnce(async () => {
    await saveLocalLogin(db, priorRecord)
    return response
  }).mockResolvedValueOnce(response)
  const wrapped = trackRelaySession({ db, transport, clock })
  const request = { path: sessionPath, token, bodyText: '{}' }
  expect(await wrapped.send(request)).toBe(response)
  expect(await getLocalLogin(db)).toEqual(priorRecord)
  db.close()
  expect(await wrapped.send(request)).toBe(response)
})

it('本機到期判斷取較早時間並看重新登入標記', () => {
  expect(getLocalSessionState(undefined, time)).toBe('no_login')
  expect(getLocalSessionState(loginRecord, time)).toBe('valid')
  const record = { ...loginRecord, firstRelayedAt: time, expiresAt: iso(time + 1000) }
  expect(getLocalSessionState(record, time + 999)).toBe('valid')
  expect(getLocalSessionState(record, time + 1000)).toBe('expired')
  expect(getLocalSessionState({ ...loginRecord, requiresLogin: true }, time)).toBe('expired')
})

it('工作階段查詢成功更新有效期、清標記並回本機成功時間', async () => {
  await saveLocalLogin(db, { ...loginRecord, expiresAt: iso(time - 1), requiresLogin: true })
  transport.send.mockImplementation(async () => {
    time += 500
    return ok(sessionBody)
  })
  expect(await checkSession()).toEqual({ kind: 'success', checkedAt: initialTime + 500 })
  expect(transport.send.mock.calls).toEqual([[{ path: sessionPath, token, bodyText: '{}' }]])
  expect(await getLocalLogin(db)).toEqual(loginRecord)
})

it.each(['AUTH_REQUIRED', 'AUTH_EXPIRED'])('工作階段查詢回 %s 時只標記需重新登入', async code => {
  await saveLocalLogin(db, loginRecord)
  transport.send.mockResolvedValue(error(401, code))
  expect(await checkSession()).toEqual({ kind: 'requires_login', code })
  expect(await getLocalLogin(db)).toEqual({ ...loginRecord, requiresLogin: true })
})

it.each([
  ['成功', ok(sessionBody)],
  ['權杖到期', error(401, 'AUTH_EXPIRED')],
])('工作階段舊回應（%s）不覆寫新權杖', async (_label, response) => {
  await saveLocalLogin(db, loginRecord)
  transport.send.mockImplementation(async () => {
    await saveLocalLogin(db, priorRecord)
    return response
  })
  expect(await checkSession()).toEqual({ kind: 'stale_session' })
  expect(await getLocalLogin(db)).toEqual(priorRecord)
  expect(await markSessionRequiresLogin({ db }, token)).toBe(false)
  expect(await getLocalLogin(db)).toEqual(priorRecord)
})

it('查詢沒有本機權杖就不送出，離線時不改紀錄', async () => {
  expect(await checkSession()).toEqual({ kind: 'no_login' })
  await saveLocalLogin(db, { accountId: teacher.id })
  expect(await checkSession()).toEqual({ kind: 'no_login' })
  expect(transport.send).not.toHaveBeenCalled()
  await saveLocalLogin(db, loginRecord)
  transport.send.mockResolvedValue(lost())
  expect(await checkSession()).toEqual({ kind: 'unreachable' })
  expect(await getLocalLogin(db)).toEqual(loginRecord)
})

it('工作階段成功本文不合格時不套用有效期', async () => {
  await saveLocalLogin(db, loginRecord)
  transport.send.mockResolvedValue(ok({ ...sessionBody, expires_at: '測試用無效日期' }))
  expect(await checkSession()).toEqual({ kind: 'invalid_response' })
  expect(await getLocalLogin(db)).toEqual(loginRecord)
})

it('工作階段回應的老師和本機登入的帳號不同時不套用', async () => {
  const record = { ...loginRecord, expiresAt: iso(time - 1), requiresLogin: true }
  await saveLocalLogin(db, record)
  transport.send.mockResolvedValue(ok({ ...sessionBody, teacher: { ...teacher, id: '另一個測試用帳號' } }))
  expect(await checkSession()).toEqual({ kind: 'invalid_response' })
  expect(await getLocalLogin(db)).toEqual(record)
})

it('轉送通行碼可重開連線後讀回，連線關閉後讀取會失敗', async () => {
  const store = createIndexedDbRelayPassStore({ db })
  expect(await store.read()).toBeNull()
  await store.write(relayPass)
  expect(await store.read()).toBe(relayPass)
  expect(await getDeviceSetting(db, 'relay_pass')).toBe(relayPass)
  db.close()
  await expect(store.read()).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
  db = await openQueueDatabase({ factory })
  expect(await createIndexedDbRelayPassStore({ db }).read()).toBe(relayPass)
})

it('真正連線物件補上轉送通行碼後登入成功，且轉送包裝省略權杖', async () => {
  const relayPassStore = createIndexedDbRelayPassStore({ db })
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('測試用直連失敗'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ v: 1, http_status: 0, gas_error: 'RELAY_FORBIDDEN' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ v: 1, http_status: 200, body_text: JSON.stringify(loginBody) })))
  transport = createTransport({
    fetch, backendOrigin: 'https://backend.invalid', gasUrl: 'https://relay.invalid/exec',
    relayPassStore, clock: { ...clock, setTimeout, clearTimeout },
    isRouteSuccess: ({ status, code }) => status === 200 || code === 'RELAY_FORBIDDEN',
  })
  expect(await signIn()).toEqual({ kind: 'relay_pass_required' })
  await relayPassStore.write(relayPass)
  expect(await signIn()).toMatchObject({ kind: 'success' })
  const request = JSON.parse(fetch.mock.calls[2][1].body)
  expect(request).toHaveProperty('relay_pass', relayPass)
  expect(request).not.toHaveProperty('token')
  expect(await getLocalLogin(db)).toEqual({ ...loginRecord, loginVia: 'gas', firstRelayedAt: time })
})
