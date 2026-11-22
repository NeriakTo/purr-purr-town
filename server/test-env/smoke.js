import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ConfigError, isEntryPoint, readSecret } from './secrets.js'

const studentNames = ['測試甲', '測試乙', '測試丙']
const adjustment = 7

class SmokeError extends Error {
  constructor(step, name) {
    super('步驟 ' + step + ' ' + name + ' 失敗')
    this.step = step
  }
}

function createStepRunner(log) {
  return async function runStep(step, name, work) {
    let result
    try {
      result = await work()
      if (!result) throw new Error()
    } catch {
      const failure = new SmokeError(step, name)
      log(failure.message)
      throw failure
    }
    log('步驟 ' + step + ' ' + name + ' 通過')
    return result
  }
}

async function expectOk(pendingResponse) {
  const { status, json } = await pendingResponse
  if (status !== 200 || !json || typeof json !== 'object' || Array.isArray(json)) throw new Error()
  return json
}

async function isAuthRequired(pendingResponse) {
  const { status, json } = await pendingResponse
  return status === 401 && json?.error?.code === 'AUTH_REQUIRED'
}

function createOperation(type, payload) {
  return { op_id: randomUUID(), type, payload }
}

function createClassBatch(classId, className, teacherName, studentIds) {
  const create = createOperation('class.create', {
    class_id: classId, school_year: '115', name: className, teacher_name: teacherName,
    alias: '', student_count: studentIds.length, student_ids: studentIds,
  })
  // OP-01 只接受學生編號。接著用 OP-05 將預設名稱改為假名。
  const names = studentIds.map((studentId, index) => ({
    ...createOperation('student.update_profile', { student_id: studentId, name: studentNames[index] }),
    expect: { rev: 1 },
  }))
  return { v: 1, class_id: classId, ops: [create, ...names] }
}

async function expectCommitted(pendingResponse, ops) {
  const { receipts } = await expectOk(pendingResponse)
  if (!Array.isArray(receipts) || receipts.length !== ops.length) throw new Error()
  for (const [index, op] of ops.entries()) {
    const receipt = receipts[index]
    if (receipt?.op_id !== op.op_id || receipt.status !== 'committed'
      || receipt.code !== 'OK' || receipt.replayed !== false) throw new Error()
  }
  return receipts
}

function hasExpectedState(rows, { classId, className, studentIds }) {
  if (!Array.isArray(rows)) return false
  const hasClass = rows.some(row => row.entity === 'class'
    && row.key?.class_id === classId && row.value?.name === className)
  const hasStudents = studentIds.every((id, index) => rows.some(row => row.entity === 'student'
    && row.key?.student_id === id && row.value?.name === studentNames[index]))
  const hasBalance = rows.some(row => row.entity === 'account'
    && row.key?.student_id === studentIds[0] && row.value?.balance === adjustment)
  return hasClass && hasStudents && hasBalance
}

export async function runSmoke({ send, name, passcode, log = console.log }) {
  const step = createStepRunner(log)
  const classesPath = '/read/classes'
  const post = (path, body, headers = {}) => send('POST', '/api/v2' + path, { headers, body })

  await step(1, '未登入拒絕', () => isAuthRequired(post(classesPath)))
  const token = await step(2, '登入', async () => {
    const login = await expectOk(post('/auth/login', { name, passcode }))
    return typeof login.token === 'string' && /^[0-9a-f]{64}$/.test(login.token) && login.token
  })
  const authed = (path, body) => post(path, body, { authorization: 'Bearer ' + token })
  await step(3, '查詢工作階段', async () => (await expectOk(authed('/auth/session'))).teacher?.name === name)
  await step(4, '列班級', async () => Array.isArray((await expectOk(authed(classesPath))).classes))

  const classId = randomUUID()
  const className = 'smoke-' + classId
  const studentIds = studentNames.map(() => randomUUID())
  const createBatch = createClassBatch(classId, className, name, studentIds)
  const createReceipts = await step(5, '建立假班', () => expectCommitted(authed('/ops', createBatch), createBatch.ops))
  await step(6, '重送建班請求', async () => {
    const { receipts } = await expectOk(authed('/ops', createBatch))
    return isDeepStrictEqual(receipts, createReceipts.map(receipt => ({ ...receipt, replayed: true })))
  })
  const points = createOperation('points.adjust', {
    student_id: studentIds[0], amount: adjustment, reason: '冒煙測試',
  })
  const pointsBatch = { v: 1, class_id: classId, ops: [points] }
  const [pointsReceipt] = await step(7, '手動調整點數', () => expectCommitted(authed('/ops', pointsBatch), [points]))
  await step(8, '讀取班級與餘額', async () => {
    const { rows } = await expectOk(authed('/read/state', { class_id: classId }))
    return hasExpectedState(rows, { classId, className, studentIds })
  })

  const cancelId = randomUUID()
  await step(9, '放棄新操作', async () => {
    const { receipt } = await expectOk(authed('/ops/cancel', { class_id: classId, op_id: cancelId }))
    return receipt?.op_id === cancelId && receipt.status === 'cancelled'
  })
  await step(10, '查詢原收據', async () => {
    const { results } = await expectOk(authed('/ops/lookup', { class_id: classId, op_ids: [points.op_id] }))
    return isDeepStrictEqual(results, [{ ...pointsReceipt, op_type: points.type }])
  })
  await step(11, '登出與權杖失效', async () => {
    await expectOk(authed('/auth/logout'))
    return isAuthRequired(authed(classesPath))
  })
}

function readBaseUrl(value) {
  const url = URL.parse(value)
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('SMOKE_BASE_URL_INVALID PPT_SMOKE_BASE_URL')
  }
  return url
}

function createHttpSender(baseUrl) {
  return async function send(method, path, { headers, body }) {
    const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(45_000) }
    if (body !== undefined) {
      options.headers = { ...headers, 'content-type': 'application/json' }
      options.body = JSON.stringify(body)
    }
    const response = await fetch(new URL(path, baseUrl), options)
    return { status: response.status, json: await response.json() }
  }
}

async function main() {
  const baseUrl = readBaseUrl(process.env.PPT_SMOKE_BASE_URL)
  const name = process.env.PPT_SMOKE_TEACHER_NAME
  if (!name || name.length > 50) throw new ConfigError('SMOKE_NAME_INVALID PPT_SMOKE_TEACHER_NAME')
  const passcode = await readSecret('PPT_SMOKE_PASSWORD_FILE')
  await runSmoke({ send: createHttpSender(baseUrl), name, passcode })
}

if (isEntryPoint(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    if (!(error instanceof SmokeError)) {
      console.error(error instanceof ConfigError ? error.message : 'SMOKE_FAILED')
    }
    process.exitCode = 1
  }
}
