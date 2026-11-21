import { createHash, timingSafeEqual } from 'node:crypto'

function digestKey(key) {
  return createHash('sha256').update(key).digest()
}

export function createRelayCheck(key) {
  if (key == null || key === '') return () => false
  if (typeof key !== 'string' || key.length < 32 || /[^\x20-\x7e]/.test(key)) {
    throw new Error('relayKey 須為至少 32 個可列印 ASCII 字元')
  }
  const expected = digestKey(key)
  return function isGasRelay(headers) {
    const supplied = headers['x-ppt-relay-key']
    return typeof supplied === 'string' && timingSafeEqual(digestKey(supplied), expected)
  }
}
