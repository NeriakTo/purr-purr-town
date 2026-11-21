import { validateClassEnvelope } from '../ops/envelope.js'

export function readClassEnvelope(body) {
  validateClassEnvelope(body)
  return { classId: body.class_id }
}
