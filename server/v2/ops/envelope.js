import { RequestError } from '../errors.js'

const maxOps = 50
const maxPayloadBytes = 64 * 1024
const operationKeys = ['op_id', 'type', 'payload', 'expect', 'client_time', 'client_seq']

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function validateOperations(ops) {
  const ids = new Set()
  for (const op of ops) {
    if (!isObject(op)) throw new RequestError('BAD_ENVELOPE')
    if (Object.hasOwn(op, 'payload') && Buffer.byteLength(JSON.stringify(op.payload), 'utf8') > maxPayloadBytes) {
      throw new RequestError('BAD_ENVELOPE')
    }
    if (typeof op.op_id === 'string') {
      if (ids.has(op.op_id)) throw new RequestError('BAD_ENVELOPE')
      ids.add(op.op_id)
    }
  }
}

export function validateSubmitEnvelope(body) {
  if (!isObject(body) || body.v !== 1 || !isNonEmptyString(body.class_id)
    || (Object.hasOwn(body, 'batch_id') && body.batch_id !== null && !isNonEmptyString(body.batch_id))
    || !Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > maxOps) {
    throw new RequestError('BAD_ENVELOPE')
  }
  validateOperations(body.ops)
}

export function buildOperation(op, envelope) {
  const operation = { class_id: envelope.class_id }
  if (Object.hasOwn(envelope, 'batch_id')) operation.batch_id = envelope.batch_id
  for (const key of operationKeys) {
    if (Object.hasOwn(op, key)) operation[key] = op[key]
  }
  return operation
}
