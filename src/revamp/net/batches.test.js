import { expect, it } from 'vitest'
import { splitSubmitBatches } from './batches.js'

const classId = '測試班級'
const encoder = new TextEncoder()
const bytes = text => encoder.encode(text).length
const maxRequestBytes = 512 * 1024
const maxPayloadBytes = 63 * 1024

function operation(clientSeq, fields = {}) {
  return {
    v: 1, batch_id: null, op_id: '測試操作' + clientSeq, type: 'submission.set_status',
    payload: { 測試: '狀態' }, client_time: '2026-01-01T00:00:00Z',
    client_seq: clientSeq, local_status: 'pending', ...fields,
  }
}

function outerBytes(bodyText, relayPass) {
  return bytes(JSON.stringify({
    v: 1, path: '/api/v2/ops', token: 'a'.repeat(64), relay_pass: relayPass, body_text: bodyText,
  }))
}

it('五十一筆切為五十加一，保留排序並只送出指定欄位', () => {
  const operations = Array.from({ length: 51 }, (_, index) => operation(index + 1))
  operations[1].expect = null
  const { bodies, blocked } = splitSubmitBatches({ classId, operations })
  const batches = bodies.map(body => JSON.parse(body))
  expect(blocked).toBeNull()
  expect(batches.map(batch => batch.ops.length)).toEqual([50, 1])
  expect(batches.flatMap(batch => batch.ops.map(op => op.client_seq))).toEqual(operations.map(op => op.client_seq))
  expect(batches[0]).toMatchObject({ v: 1, class_id: classId, batch_id: null })
  const { op_id, type, payload, client_time, client_seq } = operations[0]
  expect(batches[0].ops[0]).toEqual({ op_id, type, payload, client_time, client_seq })
  expect(batches[0].ops[0]).not.toHaveProperty('expect')
  expect(batches[0].ops[1]).toHaveProperty('expect', null)
})

it('版本或批次編號改變就分批，原有順序不重排', () => {
  const operations = [
    operation(1), operation(2, { batch_id: '另一批' }), operation(3, { batch_id: '另一批', v: 2 }),
    operation(4),
  ]
  const { bodies } = splitSubmitBatches({ classId, operations })
  expect(bodies.map(body => {
    const { v, batch_id, ops } = JSON.parse(body)
    return [v, batch_id, ops.map(op => op.client_seq)]
  })).toEqual([[1, null, [1]], [1, '另一批', [2]], [2, '另一批', [3]], [1, null, [4]]])
})

it('本文放得下但轉送外層因跳脫而超過上限時仍切開', () => {
  const relayPass = '測試"\\🐾\n'
  const operations = Array.from({ length: 5 }, (_, index) =>
    operation(index + 1, { payload: '"'.repeat(29_000) }),
  )
  const { bodies, blocked } = splitSubmitBatches({ classId, operations, relayPass })
  expect(blocked).toBeNull()
  const [first, ...rest] = bodies.map(body => JSON.parse(body))
  const merged = JSON.stringify({ ...first, ops: [first, ...rest].flatMap(batch => batch.ops) })
  expect(bytes(merged)).toBeLessThan(maxRequestBytes)
  expect(outerBytes(merged, relayPass)).toBeGreaterThan(maxRequestBytes)
  expect(bodies).toHaveLength(2)
  expect(bodies.every(body => outerBytes(body, relayPass) <= maxRequestBytes)).toBe(true)
  expect(JSON.parse(merged).ops.map(op => op.client_seq)).toEqual([1, 2, 3, 4, 5])
})

it('以 UTF-8 計單筆大小，恰好上限可送，超過時停在該筆之前', () => {
  const atLimit = '測'.repeat((maxPayloadBytes - 3) / 3) + 'a'
  expect(bytes(JSON.stringify(atLimit))).toBe(maxPayloadBytes)
  const operations = [
    operation(1, { payload: atLimit }), operation(2, { payload: atLimit + 'a' }), operation(3),
  ]
  const { bodies, blocked } = splitSubmitBatches({ classId, operations })
  expect(bodies.map(body => JSON.parse(body).ops.map(op => op.client_seq))).toEqual([[1]])
  expect(blocked).toEqual({ opId: operations[1].op_id, clientSeq: 2, reason: 'payload_too_large' })
})

it('通行碼用實際字串精算或用長度保守估算，單筆包不下時停止', () => {
  const operations = [operation(1), operation(2)]
  const relayPass = '\0'.repeat(90_000)
  const exact = splitSubmitBatches({ classId, operations, relayPass })
  expect(exact.bodies).toEqual([])
  expect(exact.blocked).toMatchObject({ clientSeq: 1, reason: 'request_too_large' })
  expect(splitSubmitBatches({ classId, operations, relayPassLength: relayPass.length })).toEqual(exact)
  expect(splitSubmitBatches({ classId, operations, relayPass: 'a'.repeat(relayPass.length) }).blocked).toBeNull()
  expect(splitSubmitBatches({ classId, operations: [] })).toEqual({ bodies: [], blocked: null })
})
