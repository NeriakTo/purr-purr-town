import { encodeRelayRequest } from './relay-envelope.js'

const SUBMIT_PATH = '/api/v2/ops'
const MAX_OPERATIONS = 50
const MAX_REQUEST_BYTES = 512 * 1024
const MAX_PAYLOAD_BYTES = 63 * 1024
const SIZE_ESTIMATE_TOKEN = '0'.repeat(64)
const encoder = new TextEncoder()
const utf8Size = text => encoder.encode(text).length

function fits(batch, directBytes, gasBytes) {
  const commaBytes = Number(batch.ops.length > 0)
  return batch.directBytes + commaBytes + directBytes <= MAX_REQUEST_BYTES &&
    batch.gasBytes + commaBytes + gasBytes <= MAX_REQUEST_BYTES
}

// operations 已依同一班的 client_seq 排序。保留原順序，只回傳可送的前綴。
export function splitSubmitBatches({ classId, operations, relayPass, relayPassLength = 0 }) {
  if (typeof relayPass !== 'string' && (!Number.isSafeInteger(relayPassLength) || relayPassLength < 0)) {
    throw new RangeError('通行碼長度須為非負整數')
  }
  const exactPass = typeof relayPass === 'string'
  // 只有長度時，以每個 UTF-16 碼元最多六個 JSON 位元組計，並保留通行碼欄位的開銷。
  const passEstimate = exactPass ? relayPass : relayPassLength > 0 ? 'x' : undefined
  const passExtraBytes = !exactPass && relayPassLength > 0 ? relayPassLength * 6 - 1 : 0
  const bodies = []
  let batch
  let blocked = null

  function flush() {
    if (batch?.ops.length) bodies.push(batch.prefix + batch.ops.join(',') + ']}')
  }

  for (const op of operations) {
    const { v, op_id, type, payload, expect, client_time, client_seq } = op
    if (utf8Size(JSON.stringify(payload) ?? '') > MAX_PAYLOAD_BYTES) {
      blocked = { opId: op_id, clientSeq: client_seq, reason: 'payload_too_large' }
      break
    }

    const batchId = op.batch_id ?? null
    const serialized = JSON.stringify({ op_id, type, payload, expect, client_time, client_seq })
    const directBytes = utf8Size(serialized)
    // 每筆在 GAS 外層是同一段內容的 JSON 字串跳脫，扣掉單獨序列化時的前後引號。
    const gasBytes = utf8Size(JSON.stringify(serialized)) - 2
    if (!batch || batch.v !== v || batch.batchId !== batchId ||
        batch.ops.length === MAX_OPERATIONS || !fits(batch, directBytes, gasBytes)) {
      flush()
      const emptyBody = JSON.stringify({ v, class_id: classId, batch_id: batchId, ops: [] })
      const wrapped = encodeRelayRequest({
        path: SUBMIT_PATH, token: SIZE_ESTIMATE_TOKEN, relayPass: passEstimate, bodyText: emptyBody,
      })
      batch = {
        v, batchId, prefix: emptyBody.slice(0, -2), ops: [],
        directBytes: utf8Size(emptyBody), gasBytes: utf8Size(wrapped) + passExtraBytes,
      }
    }
    if (!fits(batch, directBytes, gasBytes)) {
      blocked = { opId: op_id, clientSeq: client_seq, reason: 'request_too_large' }
      break
    }
    const commaBytes = Number(batch.ops.length > 0)
    batch.directBytes += commaBytes + directBytes
    batch.gasBytes += commaBytes + gasBytes
    batch.ops.push(serialized)
  }
  flush()

  return { bodies, blocked }
}
