import { retryDelaySeconds } from './queue-rules.js'

const requestActions = {
  AUTH_REQUIRED: 'wait_for_login',
  AUTH_EXPIRED: 'wait_for_login',
  CLASS_FORBIDDEN: 'wait_for_login',
  RATE_LIMITED: 'retry',
  SERVER_BUSY: 'retry',
  INTERNAL_ERROR: 'internal_error',
  ORIGIN_FORBIDDEN: 'internal_error',
  BAD_ENVELOPE: 'bad_envelope',
}

const gasActions = {
  AUTH_REQUIRED: 'wait_for_login',
  RELAY_FORBIDDEN: 'wait_for_relay_pass',
  UPSTREAM_UNREACHABLE: 'retry',
  BAD_ENVELOPE: 'bad_envelope',
  ROUTE_NOT_ALLOWED: 'start_cancel',
}

const retryActions = {
  CLASS_FORBIDDEN: 'wait_for_login',
  SERVER_BUSY: 'retry',
  INTERNAL_ERROR: 'internal_error',
  NOT_PROCESSED: 'retry',
  BAD_ENVELOPE: 'bad_envelope',
  INVALID_OP_ID: 'needs_attention',
  OP_ID_REUSED: 'start_cancel',
}

const reportCodes = ['UNKNOWN_OP_TYPE', 'INVALID_PAYLOAD', 'FORBIDDEN_ROLE', 'ID_CONFLICT']
const teacherCodes = [
  'SCOPE_FORBIDDEN', 'NOT_FOUND', 'STALE_STATE', 'INVALID_TRANSITION', 'ENTITY_INACTIVE',
  'CLASS_ARCHIVED', 'INSUFFICIENT_BALANCE', 'OUT_OF_STOCK', 'PRICE_CHANGED', 'ITEM_ALREADY_USED',
  'RULE_VERSION_STALE', 'TX_NOT_REVERSIBLE', 'TX_ALREADY_REVERSED', 'NOT_UNDOABLE',
  'UNDO_CONFLICT', 'COMMENT_LOCKED', 'LEGACY_EFFECT_UNRESOLVED',
]
const rereadCodes = ['ALREADY_UNDONE', 'CONFIRMATION_NOT_PENDING']
const outsideQueue = {
  PAIRING_INVALID: null,
  LEGACY_WRITE_CLOSED: null,
  LOGIN_FAILED: null,
  CALL_ID_REUSED: '回報',
  HELD_QUEUE_FULL: '重送',
  CONFIRMATION_REJECTED: '移除',
  HELD_OP_OUTDATED: '移除',
}

const groups = [
  ['重送', ['RATE_LIMITED', 'SERVER_BUSY', 'UPSTREAM_UNREACHABLE', 'INTERNAL_ERROR', 'NOT_PROCESSED', 'ORIGIN_FORBIDDEN']],
  ['重新登入後重送', ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'CLASS_FORBIDDEN', 'RELAY_FORBIDDEN']],
  ['回報', ['BAD_ENVELOPE', 'ROUTE_NOT_ALLOWED', 'INVALID_OP_ID', 'OP_ID_REUSED', ...reportCodes]],
  ['請老師處理', teacherCodes],
  ['移除', ['OK', 'HELD_FOR_TEACHER', 'OP_CANCELLED', ...rereadCodes]],
]

export const codeDispositions = Object.freeze({
  ...Object.fromEntries(groups.flatMap(([disposition, codes]) => codes.map(code => [code, disposition]))),
  ...outsideQueue,
})

const savedStatuses = new Set(['committed', 'held', 'cancelled', 'rejected'])
const receiptKeys = { submit: 'receipts', cancel: 'receipt', lookup: 'results' }
const hasCode = value => typeof value === 'string' && value.length > 0
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNonnegativeInteger = value => Number.isInteger(value) && value >= 0

function undecided(reason) {
  return { type: 'undecided', reason }
}

function attention(programmerError) {
  return { type: 'needs_attention', programmerError }
}

function rejectAction(code) {
  if (rereadCodes.includes(code)) return { type: 'remove_and_read' }
  if (teacherCodes.includes(code)) return attention(false)
  if (reportCodes.includes(code) || !Object.hasOwn(codeDispositions, code)) return attention(true)
  return undecided('unsupported_code_location')
}

// 只讓可辨識的提交結果結束連續計數。GAS 自己回錯或尚未處理時，保留原計數。
function countInternalErrors(item, { endpoint, hasHttpResponse }, code, type) {
  if (endpoint !== 'submit' || !hasHttpResponse || type === 'undecided'
      || code === 'NOT_PROCESSED') return item.internalErrors
  return type === 'internal_error' ? item.internalErrors + 1 : 0
}

function decideTemporary(table, { endpoint, level, code, single, attempts, retryAfter }) {
  if (Object.hasOwn(outsideQueue, code)) return undecided('code_outside_teacher_queue')
  if (level === 'receipt' && endpoint === 'lookup') return undecided('unsupported_receipt_status')
  const type = Object.hasOwn(table, code) ? table[code] : null
  if (!type && (Object.hasOwn(codeDispositions, code) || level === 'gas')) {
    return undecided('unsupported_code_location')
  }
  if (type === 'needs_attention' || (endpoint === 'cancel' && code === 'OP_ID_REUSED')) return attention(true)
  if (endpoint === 'lookup') return { type: 'keep' }
  if (endpoint === 'cancel') {
    const action = { type: 'keep_cancelling' }
    if (!type || type === 'retry' || type === 'internal_error') {
      action.waitSeconds = retryDelaySeconds(attempts, retryAfter)
    }
    return action
  }
  if (type === 'bad_envelope' && !single) return { type: 'retry_single' }
  if (type === 'start_cancel' || type === 'bad_envelope') return { type: 'start_cancel', programmerError: true }
  return { type: type ?? 'internal_error' }
}

function withAction(item, context, fields, decision) {
  const { via } = context
  const internalErrors = countInternalErrors(item, context, fields.code, decision.type)
  let action = decision
  if (decision.type === 'internal_error') action = { type: internalErrors >= 5 ? 'pause' : 'retry' }
  if (action.type === 'retry') {
    action = { ...action, waitSeconds: retryDelaySeconds(item.attempts, fields.retryAfter) }
  }

  const { retryAfter, ...metadata } = fields
  return { op_id: item.op_id, state: item.state, via, internalErrors, ...metadata, ...action }
}

function matchesReceiptId(receipt, opId, endpoint) {
  const { op_id, status, code } = receipt
  if (op_id === (opId ?? null)) return true
  // 寫入程序會把不能當作文字編號的輸入回成 null，停批則原樣帶回。
  return status === 'retry' && op_id === null && code !== 'NOT_PROCESSED'
    && (typeof opId !== 'string' || (code === 'INVALID_OP_ID' && endpoint === 'cancel' && opId.includes('\u0000')))
}

function hasSavedFields(receipt, endpoint) {
  const { status, op_id, class_seq, committed_at, replayed, result, changes, warnings } = receipt
  return typeof op_id === 'string'
    && (status === 'committed'
      ? isNonnegativeInteger(class_seq) && hasCode(committed_at)
      : class_seq === null && committed_at === null)
    && typeof replayed === 'boolean' && isObject(result) && typeof result.noop === 'boolean'
    && Array.isArray(result.transactions) && Array.isArray(result.effects_added)
    && Array.isArray(result.effects_reversed) && Array.isArray(changes) && Array.isArray(warnings)
    && (!Object.hasOwn(receipt, 'current') || isObject(receipt.current))
    && (endpoint !== 'lookup' || receipt.op_type === null || typeof receipt.op_type === 'string')
}

function inspectReceipt(receipt, item, context) {
  const { endpoint } = context
  if (!isObject(receipt) || !Object.hasOwn(receipt, 'op_id') || !hasCode(receipt.status)) {
    return undecided('missing_receipt_fields')
  }
  if (!matchesReceiptId(receipt, item.op_id, endpoint)) return undecided('receipt_id_mismatch')

  const { status, code } = receipt
  if (status === 'unknown') {
    if (endpoint !== 'lookup') return undecided('unsupported_receipt_status')
    return typeof receipt.op_id === 'string' && Object.keys(receipt).length === 2
      ? { type: 'keep' } : undecided('missing_receipt_fields')
  }
  if (status === 'retry') {
    if (!hasCode(code) || Object.keys(receipt).length !== 3) return undecided('missing_receipt_fields')
    return decideTemporary(retryActions, { ...context, level: 'receipt', code, attempts: item.attempts })
  }
  if (!savedStatuses.has(status)) return undecided('unsupported_receipt_status')
  if (!hasCode(code) || !hasSavedFields(receipt, endpoint)) return undecided('missing_receipt_fields')
  if (Object.hasOwn(outsideQueue, code)) return undecided('code_outside_teacher_queue')
  if (status !== 'rejected') return { type: 'remove' }
  return rejectAction(code)
}

/**
 * 依送出順序回傳動作。single 表示這次確實以單筆請求送出。
 * 外層序號只供呼叫端觀測，原收據則交給呼叫端做版本比對。
 */
export function decideReceipts({ endpoint, items, single, result }) {
  const { via } = result
  const context = { endpoint, single, via, hasHttpResponse: result.kind === 'http' }
  const all = (fields, decision) => ({
    actions: items.map(item => withAction(item, context, fields, decision(item))),
  })
  const unresolved = (reason, level = 'request', code = null) =>
    all({ level, code }, () => undecided(reason))

  if (result.kind === 'lost') {
    return all({ level: 'request', code: 'RESPONSE_LOST', reason: result.reason }, item => {
      if (endpoint === 'lookup') return { type: 'keep' }
      if (endpoint === 'cancel') return { type: 'keep_cancelling', waitSeconds: retryDelaySeconds(item.attempts) }
      return { type: 'retry' }
    })
  }
  if (result.kind === 'gas_error') {
    const fields = { level: 'gas', code: result.code }
    return all(fields, item => decideTemporary(gasActions, { ...context, ...fields, attempts: item.attempts }))
  }

  let body
  try {
    body = JSON.parse(result.bodyText)
  } catch {
    return unresolved('invalid_json')
  }
  if (!isObject(body)) return unresolved('invalid_body')

  const responseKey = receiptKeys[endpoint]
  if (Object.hasOwn(body, 'error')) {
    if (Object.values(receiptKeys).some(key => Object.hasOwn(body, key))) return unresolved('missing_envelope_fields')
    if (body.success === false && typeof body.error === 'string' && body.code === 'LEGACY_WRITE_CLOSED') {
      return unresolved('code_outside_teacher_queue', 'request', body.code)
    }
    if (!isObject(body.error) || !hasCode(body.error.code)) return unresolved('missing_error_fields')

    const { code, retry_after: retryAfter } = body.error
    if (code === 'RATE_LIMITED' && !isNonnegativeInteger(retryAfter)) {
      return unresolved('missing_retry_after', 'request', code)
    }
    const fields = { level: 'request', code, retryAfter: code === 'RATE_LIMITED' ? retryAfter : undefined }
    return all(fields, item => decideTemporary(requestActions, { ...context, ...fields, attempts: item.attempts }))
  }

  const receipts = endpoint === 'cancel' ? [body.receipt] : body[responseKey]
  if (!hasCode(body.server_time) || !Object.hasOwn(body, responseKey) || !Array.isArray(receipts)
      || (endpoint === 'submit' && body.class_seq !== null && !isNonnegativeInteger(body.class_seq))) {
    return unresolved('missing_envelope_fields')
  }
  if (receipts.length !== items.length) return unresolved('receipt_count_mismatch', 'receipt')

  const actions = receipts.map((receipt, index) => {
    const item = items[index]
    const code = hasCode(receipt?.code) ? receipt.code : null
    const decision = inspectReceipt(receipt, item, context)
    const fields = { level: 'receipt', code }
    if (decision.type !== 'undecided') fields.receipt = receipt
    if (decision.type === 'needs_attention' && receipt.current !== undefined) fields.current = receipt.current
    return withAction(item, context, fields, decision)
  })
  return endpoint === 'submit' ? { actions, submitClassSeq: body.class_seq } : { actions }
}
