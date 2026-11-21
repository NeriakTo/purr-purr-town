import { createHash } from 'node:crypto'

export function uuidV5(namespace, name) {
  const bytes = createHash('sha1').update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

export function batchUndoId(undoId, targetId) {
  return uuidV5('7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8', `batch.undo:${undoId}:${targetId}`)
}
