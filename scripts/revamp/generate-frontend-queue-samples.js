import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { buildV2App } from '../../server/v2/app.js'
import { openWebTestDatabase } from '../../server/v2/test-support/database.js'
import { createTestSession } from '../../server/v2/test-support/fixtures.js'
import { agentSubmit, authorizeAgent } from '../../server/db-v2/test-support/agent.js'

const output = new URL('../../docs/revamp/frontend-queue/samples/', import.meta.url)
const time = '2026-11-22T08:00:00.000Z'
const sqlTime = '2026-11-22T07:59:00+00:00'
const importedTime = '2026-11-20T04:00:00+00:00'
const teacherId = 'sample-teacher'
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0')
const classId = id(1)
const studentIds = Array.from({ length: 6 }, (_, index) => id(index + 2))
const studentId = studentIds[0]
const taskId = id(8)
const legacyTask = 'sample-legacy-task'
const legacyEffect = '00000000-sample-legacy-effect'
const legacyTransaction = 'sample-legacy-transaction'

function normalizeSamples(samples) {
  const generatedIds = new Map()
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+00:00$/
  const timestamps = new Set()
  const randomId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

  function collectTimestamps(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(collectTimestamps)
    } else if (typeof value === 'string' && value !== importedTime && timestamp.test(value)) {
      timestamps.add(value)
    }
  }
  collectTimestamps(samples)
  function timestampKey(value) {
    const [seconds, fraction = ''] = value.replace('+00:00', '').split('.')
    return seconds + '.' + fraction.padEnd(6, '0')
  }
  const orderedTimes = [...timestamps].map(value => [timestampKey(value), value])
  orderedTimes.sort(([left], [right]) => left < right ? -1 : Number(left > right))
  const generatedTimes = new Map(orderedTimes.map(([, value], index) => [
    value, sqlTime.replace('+00:00', '.' + String(index + 1).padStart(6, '0') + '+00:00'),
  ]))

  function normalize(value, key) {
    if (Array.isArray(value)) return value.map(item => normalize(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, normalize(item, field)]))
    }
    if (typeof value !== 'string') return value
    if (key === 'next') {
      const cursor = JSON.parse(Buffer.from(value, 'base64url').toString())
      return Buffer.from(JSON.stringify(normalize(cursor))).toString('base64url')
    }
    if (randomId.test(value) && !value.startsWith('00000000-0000-4000-8000-')) {
      if (!generatedIds.has(value)) generatedIds.set(value, id(9000 + generatedIds.size))
      return generatedIds.get(value)
    }
    return generatedTimes.get(value) ?? value
  }

  return Object.fromEntries(Object.entries(samples).map(([name, body]) => [name, normalize(body)]))
}

async function seedLegacyExample(client) {
  await client.query(`
    INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester)
    VALUES ($1, $2, '測試舊作業', '作業', '2026-11-19', '2026-11-20', '115-1');
  `, [classId, legacyTask])
  await client.query(`
    INSERT INTO ppt.submissions (class_id, task_id, student_id, status, legacy_status_at_import)
    VALUES ($1, $2, $3, 'missing', 'missing');
  `, [classId, legacyTask, studentId])
  await client.query(`
    INSERT INTO ppt.transactions (class_id, transaction_id, student_id, kind, amount, earned_delta,
      occurred_at, effective_at, reason, origin, batch_id, semester)
    VALUES ($1, $2, $3, 'legacy_general', -6, -6, $4, $4, '作業缺交', 'migration', '測試匯入批次', '115-1');
  `, [classId, legacyTransaction, studentId, importedTime])
  await client.query(`
    INSERT INTO ppt.effects (class_id, effect_id, student_id, subject_kind, subject_key, status, origin, lineage_id)
    VALUES ($1, $2, $3, 'task', $4, 'legacy_unresolved', 'legacy', $2);
  `, [classId, legacyEffect, studentId, legacyTask])
}

async function capture(client, app, token) {
  async function request(path, payload, status = 200) {
    const response = await app.inject({
      method: 'POST', url: '/api/v2/' + path,
      headers: { authorization: 'Bearer ' + token },
      payload,
    })
    assert.equal(response.statusCode, status, path + ' ' + response.body)
    return response.json()
  }

  const operation = (number, type, payload, expect) => ({
    op_id: id(number), type, payload, ...(expect ? { expect } : {}),
  })
  const submit = (...ops) => request('ops', { v: 1, class_id: classId, ops })
  const read = (path, fields) => request('read/' + path, { class_id: classId, ...fields })
  const examples = {}
  const build = operation(100, 'class.create', {
    class_id: classId, name: '測試班級', alias: '測試班', teacher_name: '測試老師',
    school_year: '115', student_count: studentIds.length, student_ids: studentIds,
  })
  examples['submit-create'] = await submit(build)
  assert.equal(examples['submit-create'].receipts[0].code, 'OK')
  examples['read-classes-before-export'] = await request('read/classes')
  await seedLegacyExample(client)

  const task = operation(101, 'task.create', {
    task_id: taskId, title: '測試作業', task_type: '作業', published_on: '2026-11-21', due_on: '2026-11-22',
    assignee_ids: studentIds.slice(1),
  })
  const missing = operation(102, 'submission.set_status', { task_id: taskId, student_id: studentId, status: 'missing' }, { rev: 0 })
  examples['submit-committed'] = await submit(task, missing)
  assert.equal(examples['submit-committed'].receipts[1].result.effects_added.length, 1)

  const noop = operation(103, missing.type, missing.payload, { after_op: missing.op_id })
  examples['submit-noop'] = await submit(noop)
  assert.equal(examples['submit-noop'].receipts[0].result.noop, true)
  const stale = operation(104, missing.type, { ...missing.payload, status: 'on_time' }, { rev: 0 })
  const badGroup = operation(105, 'group.assign_students', {
    items: [{ student_id: studentId, group_key: 'unassigned', expect: { rev: 99 } }],
  })
  const invalid = operation(106, 'points.adjust', { student_id: studentId, amount: 0 })
  examples['submit-rejected'] = await submit(stale, badGroup, invalid)
  assert.deepEqual(examples['submit-rejected'].receipts.map(item => item.code), ['STALE_STATE', 'STALE_STATE', 'INVALID_PAYLOAD'])

  examples['submit-undo'] = await submit(operation(107, 'op.undo', { target_op_id: missing.op_id }))
  const undo = examples['submit-undo'].receipts[0]
  assert.equal(undo.code, 'OK')
  assert.equal(undo.changes[0].basis_rev, 0)
  assert.equal(undo.changes[0].value.assignment_active, false)
  examples['submit-replay'] = await submit(missing)
  assert.equal(examples['submit-replay'].receipts[0].replayed, true)
  // 重現現有 HTTP 測試使用的邊界：JSONB 補空格後才超過大小上限。
  const oversized = operation(108, 'points.adjust', { pad: 'a'.repeat(64 * 1024 - 10) })
  examples['submit-retry'] = await submit(oversized, {
    ...missing, payload: { ...missing.payload, status: 'late' },
  }, {})
  assert.deepEqual(examples['submit-retry'].receipts.map(item => item.code), ['BAD_ENVELOPE', 'OP_ID_REUSED', 'INVALID_OP_ID'])

  const cancelled = id(109)
  examples['cancel-new'] = await request('ops/cancel', { class_id: classId, op_id: cancelled })
  assert.equal(examples['cancel-new'].receipt.status, 'cancelled')
  examples['cancel-original'] = await request('ops/cancel', { class_id: classId, op_id: missing.op_id })
  assert.equal(examples['cancel-original'].receipt.replayed, true)
  examples['lookup'] = await request('ops/lookup', { class_id: classId, op_ids: [missing.op_id, cancelled, id(110), stale.op_id] })
  assert.deepEqual(examples.lookup.results.map(item => item.status), ['committed', 'cancelled', 'unknown', 'rejected'])
  examples['request-error'] = await request('ops/lookup', { class_id: classId, op_ids: [] }, 400)

  const heldTask = { ...task, op_id: id(111), payload: { ...task.payload, task_id: id(9), assignee_ids: studentIds } }
  assert.equal((await submit(heldTask)).receipts[0].code, 'OK')
  await authorizeAgent(client, classId)
  const agent = await agentSubmit(client, classId, studentIds.map((student, index) =>
    operation(120 + index, missing.type, { task_id: id(9), student_id: student, status: 'missing' }, { rev: 1 }),
  ), id(112), '測試暫緩批次')
  assert.equal(agent.receipts[0].status, 'held')
  examples['agent-held'] = agent.receipts[0]
  const adjustment = operation(113, 'points.adjust', { student_id: studentId, amount: 10, reason: '測試加分' })
  assert.equal((await submit(adjustment)).receipts[0].code, 'OK')
  const setup = await submit(
    operation(114, 'product.save', { product_id: id(10), name: '測試商品', price: 3, price_unit: 'point', stock: 3, initial_stock: 3 }, { rev: 0 }),
    operation(115, 'shop.purchase', { student_id: studentId, product_id: id(10), item_id: id(11), expect_price_points: 3 }),
    operation(116, 'correction.require', { student_id: studentId, task_id: id(9), correction_id: id(12) }),
    operation(117, 'duty.set', { date: '2026-11-22', student_ids: [studentId] }, { rev: 0 }),
    operation(118, 'announcement.save', { announcement_id: id(13), text: '測試公告' }, { rev: 0 }),
    operation(119, 'comment.save', { student_id: studentId, semester: '115-1', comment: '測試評語' }, { rev: 0 }),
    operation(127, 'group.save', { group_key: '組甲', name: '測試小組' }, { rev: 0 }),
  )
  assert.deepEqual(setup.receipts.map(item => item.code), Array(7).fill('OK'))
  assert.equal((await submit({ ...adjustment, op_id: id(126) })).receipts[0].code, 'OK')

  const state = await read('state')
  examples['read-state'] = state
  assert.equal(typeof state.agent_batches[0].held_ops[0].type, 'string')
  for (const stream of ['transactions', 'operations']) {
    assert.ok(state[stream].next)
    examples['read-state-cursor-' + stream] = await read('state', { cursor: state[stream].next })
  }
  examples['read-changes-incremental'] = await read('changes', { since_seq: state.class_seq - 1 })
  assert.equal(examples['read-changes-incremental'].full, false)
  examples['read-changes-full'] = await read('changes', { since_seq: 1 })
  assert.equal(examples['read-changes-full'].full, true)
  examples['read-export'] = await read('export')
  examples['read-classes'] = await request('read/classes')
  assert.equal(examples['read-classes'].classes[0].last_export_at, examples['read-export'].exported_at)

  examples['submit-confirm-held'] = await submit(operation(128, 'confirmation.confirm', {
    confirmation_id: agent.receipts[0].result.confirmation_id,
  }))
  assert.equal(examples['submit-confirm-held'].receipts[0].result.held.items.length, studentIds.length)
  examples['submit-batch-undo'] = await submit(operation(129, 'batch.undo', { batch_id: agent.call_id, expect_op_count: studentIds.length }))
  assert.equal(examples['submit-batch-undo'].receipts[0].result.items.length, studentIds.length)

  // 操作寫入使用資料庫時鐘，存摺學期也隨之變動。樣本把它對齊固定日期。
  for (const body of Object.values(examples)) {
    const transactions = Array.isArray(body.transactions) ? body.transactions : body.transactions?.items
    const items = transactions ?? (body.stream === 'transactions' ? body.items : [])
    for (const transaction of items) {
      if (transaction.origin === 'op' && transaction.semester !== null) transaction.semester = '115-1'
    }
  }
  return normalizeSamples(examples)
}

const databaseUrl = new URL(process.env.PPT_TEST_DATABASE_URL ?? 'about:blank')
if (databaseUrl.hostname !== '127.0.0.1' || !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  throw new Error('請把 PPT_TEST_DATABASE_URL 設成只供假資料使用的 127.0.0.1 PostgreSQL 測試庫')
}
const database = await openWebTestDatabase(databaseUrl.href)
let app
try {
  const token = await createTestSession(database.client, teacherId, { expiresAt: new Date('2027-01-01Z') })
  app = buildV2App({
    pool: database.createWebsitePool(), clock: () => new Date(time),
    config: { read: { pageSize: 1, changesFullThreshold: 1 } },
  })
  const samples = await capture(database.client, app, token)
  await mkdir(output, { recursive: true })
  for (const [name, body] of Object.entries(samples)) {
    await writeFile(new URL(name + '.json', output), JSON.stringify(body, null, 2) + '\n')
  }
  console.info('已產生 ' + Object.keys(samples).length + ' 份樣本')
} finally {
  try {
    await app?.close()
  } finally {
    await database.close()
  }
}
