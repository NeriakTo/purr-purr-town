import { expect, it } from 'vitest'
import { codeDispositions, decideReceipts } from './receipts.js'

const samples = import.meta.glob('../../../docs/revamp/frontend-queue/samples/*.json', {
  eager: true, import: 'default',
})
const sample = name => samples[`../../../docs/revamp/frontend-queue/samples/${name}.json`]
const item = (op_id, fields = {}) => ({ op_id, state: 'sending', internalErrors: 0, attempts: 1, ...fields })
const http = (body, status = 200, via = 'direct') => ({ kind: 'http', via, status, bodyText: JSON.stringify(body) })
const request = (code, extra = {}) => http({ error: { code, ...extra } }, 503)
const gas = code => ({ kind: 'gas_error', via: 'gas', code })
const retry = (op_id, code) => ({ op_id, status: 'retry', code })
const time = '2026-01-01T00:00:00Z'
const submit = (...receipts) => http({ server_time: time, class_seq: 7, receipts })
const cancel = receipt => http({ server_time: time, receipt })
const lost = { kind: 'lost', via: 'direct', reason: 'timeout' }

function saved(op_id, code, status = 'rejected') {
  const template = sample(status === 'rejected' ? 'submit-rejected' : 'submit-committed').receipts[0]
  return { ...template, op_id, code, status }
}

function decide(result, { endpoint = 'submit', items = [item('a')], single = items.length === 1 } = {}) {
  return decideReceipts({ endpoint, items, single, result })
}

it('定案碼依表處置並帶回原收據', () => {
  const groups = [
    ['移除', 'remove', [
      sample('submit-committed').receipts[0], sample('agent-held'), sample('cancel-new').receipt,
    ]],
    ['回報', 'needs_attention', ['UNKNOWN_OP_TYPE', 'INVALID_PAYLOAD', 'FORBIDDEN_ROLE', 'ID_CONFLICT']],
    ['請老師處理', 'needs_attention', [
      'SCOPE_FORBIDDEN', 'NOT_FOUND', 'STALE_STATE', 'INVALID_TRANSITION', 'ENTITY_INACTIVE',
      'CLASS_ARCHIVED', 'INSUFFICIENT_BALANCE', 'OUT_OF_STOCK', 'PRICE_CHANGED', 'ITEM_ALREADY_USED',
      'RULE_VERSION_STALE', 'TX_NOT_REVERSIBLE', 'TX_ALREADY_REVERSED', 'NOT_UNDOABLE',
      'UNDO_CONFLICT', 'COMMENT_LOCKED', 'LEGACY_EFFECT_UNRESOLVED',
    ]],
    ['移除', 'remove_and_read', ['ALREADY_UNDONE', 'CONFIRMATION_NOT_PENDING']],
  ]
  for (const [disposition, type, entries] of groups) {
    for (const entry of entries) {
      const receipt = typeof entry === 'string' ? saved('a', entry) : entry
      const { code, op_id } = receipt
      expect(codeDispositions[code], code).toBe(disposition)
      const action = decide(submit(receipt), { items: [item(op_id)] }).actions[0]
      expect(action, code).toMatchObject({ type, code, level: 'receipt', receipt })
      if (type === 'needs_attention') expect(action.programmerError, code).toBe(disposition === '回報')
    }
  }
})

it('暫時型留在原位', () => {
  const cases = [
    ['AUTH_REQUIRED', request('AUTH_REQUIRED'), 'request', 'wait_for_login', '重新登入後重送'],
    ['AUTH_REQUIRED', gas('AUTH_REQUIRED'), 'gas', 'wait_for_login', '重新登入後重送'],
    ['AUTH_EXPIRED', request('AUTH_EXPIRED'), 'request', 'wait_for_login', '重新登入後重送'],
    ['CLASS_FORBIDDEN', request('CLASS_FORBIDDEN'), 'request', 'wait_for_login', '重新登入後重送'],
    ['CLASS_FORBIDDEN', submit(retry('a', 'CLASS_FORBIDDEN')), 'receipt', 'wait_for_login', '重新登入後重送'],
    ['RATE_LIMITED', request('RATE_LIMITED', { retry_after: 30 }), 'request', 'retry', '重送', 30],
    ['SERVER_BUSY', request('SERVER_BUSY'), 'request', 'retry', '重送', 2],
    ['SERVER_BUSY', submit(retry('a', 'SERVER_BUSY')), 'receipt', 'retry', '重送', 2],
    ['UPSTREAM_UNREACHABLE', gas('UPSTREAM_UNREACHABLE'), 'gas', 'retry', '重送', 2],
    ['INTERNAL_ERROR', request('INTERNAL_ERROR'), 'request', 'retry', '重送', 2],
    ['NOT_PROCESSED', submit(retry('a', 'NOT_PROCESSED')), 'receipt', 'retry', '重送', 2],
    ['RELAY_FORBIDDEN', gas('RELAY_FORBIDDEN'), 'gas', 'wait_for_relay_pass', '重新登入後重送'],
    ['ROUTE_NOT_ALLOWED', gas('ROUTE_NOT_ALLOWED'), 'gas', 'start_cancel', '回報'],
    ['RESPONSE_LOST', lost, 'request', 'retry', undefined, 2],
  ]
  for (const [code, result, level, type, disposition, waitSeconds] of cases) {
    const action = decide(result).actions[0]
    expect(action, code).toMatchObject({ type, op_id: 'a', code, level })
    expect(action.waitSeconds, code).toBe(waitSeconds)
    expect(codeDispositions[code], code).toBe(disposition)
  }
})

it('無效編號直接移入需要處理', () => {
  for (const [endpoint, result] of [
    ['submit', submit(retry(null, 'INVALID_OP_ID'))], ['cancel', cancel(retry(null, 'INVALID_OP_ID'))],
  ]) {
    expect(decide(result, { endpoint, items: [item(null)] }).actions[0]).toMatchObject({
      type: 'needs_attention', programmerError: true, code: 'INVALID_OP_ID', level: 'receipt',
    })
  }
})

it('提交與放棄的編號重複有不同出口', () => {
  const receipt = retry('a', 'OP_ID_REUSED')
  expect(decide(submit(receipt)).actions[0]).toMatchObject({
    type: 'start_cancel', programmerError: true, code: 'OP_ID_REUSED', level: 'receipt',
  })
  expect(decide(cancel(receipt), { endpoint: 'cancel' }).actions[0]).toMatchObject({
    type: 'needs_attention', programmerError: true, code: 'OP_ID_REUSED', level: 'receipt',
  })
})

it('信封錯誤依層級與是否已單獨重送處置', () => {
  const items = [item('a'), item('b')]
  for (const [result, level] of [[request('BAD_ENVELOPE'), 'request'], [gas('BAD_ENVELOPE'), 'gas']]) {
    expect(decide(result, { items }).actions).toMatchObject(items.map(({ op_id }) => ({
      op_id, type: 'retry_single', code: 'BAD_ENVELOPE', level,
    })))
    expect(decide(result).actions[0]).toMatchObject({
      type: 'start_cancel', programmerError: true, code: 'BAD_ENVELOPE', level,
    })
  }
  expect(decide(submit(retry('a', 'BAD_ENVELOPE'))).actions[0]).toMatchObject({
    type: 'start_cancel', programmerError: true, code: 'BAD_ENVELOPE', level: 'receipt',
  })
})

it('單筆信封錯誤後繼續依實收收據處置', () => {
  const items = ['a', 'b', 'c', 'd'].map(opId => item(opId))
  const result = submit(saved('a', 'OK', 'committed'), retry('b', 'BAD_ENVELOPE'),
    saved('c', 'OK', 'committed'), retry('d', 'OP_ID_REUSED'))
  expect(decide(result, { items }).actions).toMatchObject([
    { type: 'remove', code: 'OK' }, { type: 'retry_single', code: 'BAD_ENVELOPE' },
    { type: 'remove', code: 'OK' }, { type: 'start_cancel', code: 'OP_ID_REUSED' },
  ])
})

it('整批忙碌與回應遺失均沿用所有編號', () => {
  const items = [item('a', { internalErrors: 2 }), item('b', { internalErrors: 4, attempts: 2 })]
  for (const [result, code] of [[request('SERVER_BUSY'), 'SERVER_BUSY'], [lost, 'RESPONSE_LOST']]) {
    expect(decide(result, { items }).actions).toMatchObject(items.map((entry, index) => ({
      type: 'retry', op_id: entry.op_id, code, level: 'request',
      internalErrors: code === 'SERVER_BUSY' ? 0 : entry.internalErrors, waitSeconds: index ? 4 : 2,
    })))
  }
})

it('只在第五次連續內部錯誤暫停', () => {
  for (const [result, code, level] of [
    [request('ORIGIN_FORBIDDEN'), 'ORIGIN_FORBIDDEN', 'request'],
    [request('INTERNAL_ERROR'), 'INTERNAL_ERROR', 'request'],
    [submit(retry('a', 'INTERNAL_ERROR')), 'INTERNAL_ERROR', 'receipt'],
    [submit(retry('a', 'FUTURE_CODE')), 'FUTURE_CODE', 'receipt'],
    [request('FUTURE_CODE'), 'FUTURE_CODE', 'request'],
    [request('RESPONSE_LOST'), 'RESPONSE_LOST', 'request'],
  ]) {
    expect(decide(result, { items: [item('a', { internalErrors: 3 })] }).actions[0], code)
      .toMatchObject({ type: 'retry', code, level, internalErrors: 4 })
    expect(decide(result, { items: [item('a', { internalErrors: 4 })] }).actions[0], code)
      .toMatchObject({ type: 'pause', code, level, internalErrors: 5 })
  }
})

it('請求錯誤全批計數，未處理收據保留計數', () => {
  const items = [item('a', { internalErrors: 4 }), item('b', { internalErrors: 2 })]
  expect(decide(request('INTERNAL_ERROR'), { items }).actions).toMatchObject([
    { type: 'pause', internalErrors: 5 }, { type: 'retry', internalErrors: 3 },
  ])
  expect(decide(submit(retry('a', 'INTERNAL_ERROR'), retry('b', 'NOT_PROCESSED')), { items })
    .actions).toMatchObject([{ type: 'pause', internalErrors: 5 }, { type: 'retry', internalErrors: 2 }])
})

it('未列的定案拒絕直接記成程式錯誤', () => {
  const receipt = saved('a', 'FUTURE_CODE')
  expect(decide(submit(receipt)).actions[0]).toMatchObject({
    type: 'needs_attention', programmerError: true, code: 'FUTURE_CODE', level: 'receipt', receipt,
  })
})

it('放棄的暫時結果維持放棄中與原計數', () => {
  for (const [result, code, level] of [
    [lost, 'RESPONSE_LOST', 'request'], [request('CLASS_FORBIDDEN'), 'CLASS_FORBIDDEN', 'request'],
    [request('INTERNAL_ERROR'), 'INTERNAL_ERROR', 'request'], [request('ORIGIN_FORBIDDEN'), 'ORIGIN_FORBIDDEN', 'request'],
    [request('FUTURE_CODE'), 'FUTURE_CODE', 'request'], [request('BAD_ENVELOPE'), 'BAD_ENVELOPE', 'request'],
    [gas('RELAY_FORBIDDEN'), 'RELAY_FORBIDDEN', 'gas'], [cancel(retry('a', 'INTERNAL_ERROR')), 'INTERNAL_ERROR', 'receipt'],
  ]) {
    expect(decide(result, { endpoint: 'cancel', items: [item('a', { state: 'cancelling', internalErrors: 4 })] })
      .actions[0], code).toMatchObject({ type: 'keep_cancelling', code, level, internalErrors: 4 })
  }
})

it('放棄等待登入或通行碼時不附自動重送秒數', () => {
  const options = { endpoint: 'cancel', items: [item('a', { state: 'cancelling' })] }
  for (const result of [request('CLASS_FORBIDDEN'), gas('RELAY_FORBIDDEN')]) {
    const [action] = decide(result, options).actions
    expect(action.type).toBe('keep_cancelling')
    expect(action.waitSeconds).toBeUndefined()
  }
  expect(decide(request('RATE_LIMITED', { retry_after: 30 }), options).actions[0])
    .toMatchObject({ type: 'keep_cancelling', waitSeconds: 30 })
})

it('查詢錯誤不動待送項目', () => {
  const items = [item('a', { state: 'paused', internalErrors: 4 }), item('b', { state: 'queued' })]
  for (const [result, code, level] of [
    [request('CLASS_FORBIDDEN'), 'CLASS_FORBIDDEN', 'request'], [request('INTERNAL_ERROR'), 'INTERNAL_ERROR', 'request'],
    [request('FUTURE_CODE'), 'FUTURE_CODE', 'request'], [gas('RELAY_FORBIDDEN'), 'RELAY_FORBIDDEN', 'gas'],
    [lost, 'RESPONSE_LOST', 'request'],
  ]) {
    expect(decide(result, { endpoint: 'lookup', items }).actions).toMatchObject(items.map(entry => ({
      type: 'keep', internalErrors: entry.internalErrors, op_id: entry.op_id, code, level,
    })))
  }
})

const undecided = [
  ['非 JSON', 'invalid_json', { ...http({}), bodyText: '<html>' }, 'request'],
  ['本文非物件', 'invalid_body', http(null), 'request'],
  ['外層缺欄', 'missing_envelope_fields', http({ receipts: [] }), 'request'],
  ['外層同時含錯誤與收據', 'missing_envelope_fields', http({ receipts: [], error: { code: 'SERVER_BUSY' } }), 'request'],
  ['錯誤缺碼', 'missing_error_fields', http({ error: {} }), 'request'],
  ['限流缺等待秒數', 'missing_retry_after', request('RATE_LIMITED'), 'request'],
  ['收據數目不符', 'receipt_count_mismatch', submit(), 'receipt'],
  ['收據編號不符', 'receipt_id_mismatch', submit(saved('b', 'OK', 'committed')), 'receipt'],
  ['定案收據缺欄', 'missing_receipt_fields', submit({ op_id: 'a', status: 'committed', code: 'OK' }), 'receipt'],
  ['暫時型收據多欄', 'missing_receipt_fields', submit({ ...retry('a', 'SERVER_BUSY'), class_seq: 1 }), 'receipt'],
  ['未知收據狀態', 'unsupported_receipt_status', submit({ op_id: 'a', status: 'future', code: 'OK' }), 'receipt'],
  ['提交收到查無', 'unsupported_receipt_status', submit({ op_id: 'a', status: 'unknown' }), 'receipt'],
  ['請求層收到定案碼', 'unsupported_code_location', request('INVALID_PAYLOAD'), 'request'],
  ['收據收到請求層碼', 'unsupported_code_location', submit(retry('a', 'ORIGIN_FORBIDDEN')), 'receipt'],
  ['定案拒絕收到暫時碼', 'unsupported_code_location', submit(saved('a', 'SERVER_BUSY')), 'receipt'],
]
it.each(undecided)('未定｜%s', (_name, reason, result, level) => {
  expect(decide(result, { items: [item('a', { internalErrors: 4 })] }).actions[0])
    .toMatchObject({ type: 'undecided', reason, level, internalErrors: 4 })
})

it.each(['CALL_ID_REUSED', 'HELD_QUEUE_FULL', 'CONFIRMATION_REJECTED', 'HELD_OP_OUTDATED',
  'PAIRING_INVALID', 'LEGACY_WRITE_CLOSED', 'LOGIN_FAILED'])('未定｜待送清單收到 %s', code => {
  expect(Object.hasOwn(codeDispositions, code)).toBe(true)
  expect(decide(submit(saved('a', code))).actions[0]).toMatchObject({
    type: 'undecided', reason: 'code_outside_teacher_queue', code, level: 'receipt',
  })
})

it('辨認請求層的登入與舊版錯誤', () => {
  for (const [result, code] of [
    [request('LOGIN_FAILED'), 'LOGIN_FAILED'], [request('PAIRING_INVALID'), 'PAIRING_INVALID'],
    [http({ success: false, error: '已關閉', code: 'LEGACY_WRITE_CLOSED' }, 410), 'LEGACY_WRITE_CLOSED'],
  ]) {
    expect(decide(result).actions[0]).toMatchObject({
      type: 'undecided', reason: 'code_outside_teacher_queue', code, level: 'request',
    })
  }
})

it('收據只在請求中的同一位置比對編號', () => {
  const items = [item('a'), item('b'), item('c')]
  const result = submit(saved('b', 'OK', 'committed'), saved('a', 'OK', 'committed'), saved('c', 'OK', 'committed'))
  expect(decide(result, { items }).actions).toMatchObject([
    { type: 'undecided', reason: 'receipt_id_mismatch' },
    { type: 'undecided', reason: 'receipt_id_mismatch' }, { type: 'remove', op_id: 'c' },
  ])
})

it('提交、放棄、查詢與請求錯誤樣本走正式入口', () => {
  const cases = [
    ['submit-batch-undo', 'submit', ['remove']],
    ['submit-committed', 'submit', ['remove', 'remove']],
    ['submit-confirm-held', 'submit', ['remove']],
    ['submit-create', 'submit', ['remove']],
    ['submit-noop', 'submit', ['remove']],
    ['submit-rejected', 'submit', ['needs_attention', 'needs_attention', 'needs_attention']],
    ['submit-replay', 'submit', ['remove']],
    ['submit-retry', 'submit', ['retry_single', 'start_cancel', 'needs_attention']],
    ['submit-undo', 'submit', ['remove']],
    ['cancel-new', 'cancel', ['remove']],
    ['cancel-original', 'cancel', ['remove']],
    ['lookup', 'lookup', ['remove', 'remove', 'keep', 'needs_attention']],
    ['request-error', 'submit', ['start_cancel']],
  ]
  for (const [name, endpoint, expected] of cases) {
    const body = sample(name)
    const items = (body.receipts ?? body.results ?? [body.receipt ?? { op_id: 'a' }]).map(({ op_id }) => item(op_id))
    const output = decide(http(body, body.error ? 400 : 200, 'gas'), { endpoint, items })
    expect(output.actions.map(action => action.type), name).toEqual(expected)
    expect(output.submitClassSeq, name).toBe(endpoint === 'submit' ? body.class_seq : undefined)
    if (name === 'lookup') expect(output.actions[2]).toMatchObject({ code: null, level: 'receipt', receipt: body.results[2] })
    if (name === 'submit-rejected') expect(output.actions[0].current).toEqual(body.receipts[0].current)
  }
})

it('凍結輸入後產生獨立的動作與收據物件', () => {
  const receipt = Object.freeze(saved('a', 'STALE_STATE'))
  const items = Object.freeze([Object.freeze(item('a'))])
  const input = Object.freeze({ endpoint: 'submit', items, single: true, result: Object.freeze(submit(receipt)) })
  const { actions: [action] } = decideReceipts(input)
  expect(action).not.toBe(items[0])
  expect(action.receipt).not.toBe(receipt)
  expect(action.receipt).toEqual(receipt)
})
