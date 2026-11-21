import { validateClassEnvelope } from '../ops/envelope.js'
import { RequestError } from '../errors.js'

export function readClassEnvelope(body) {
  validateClassEnvelope(body)
  return { classId: body.class_id }
}

export function readChangesEnvelope(body) {
  const { classId } = readClassEnvelope(body)
  const sinceSeq = body.since_seq
  if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) throw new RequestError('BAD_ENVELOPE')
  return { classId, sinceSeq }
}
