import { RequestError } from '../errors.js'

function isCursorTimestamp(value) {
  if (typeof value !== 'string') return false
  if (value === 'infinity' || value === '-infinity') return true
  const parts = /^(\d{4,6}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?\+00:00(?: BC)?$/.exec(value)
  if (!parts) return false
  const [year, month, day] = parts[1].split('-').map(Number)
  const [hour, minute, second] = parts[2].split(':').map(Number)
  const beforeCommonEra = value.endsWith(' BC')
  if (year < 1 || year > (beforeCommonEra ? 4714 : 294276) || hour > 23 || minute > 59 || second > 59) return false
  if (beforeCommonEra && year === 4714 && (month < 11 || (month === 11 && day < 24))) return false
  const calendarYear = beforeCommonEra ? 1 - year : year
  const leap = calendarYear % 4 === 0 && (calendarYear % 100 !== 0 || calendarYear % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]
}

function isCursorKey(stream, key) {
  if (!Array.isArray(key) || !Number.isSafeInteger(key[0])) return false
  if (stream === 'operations') return key.length === 1 && key[0] > 0
  return stream === 'transactions' && key.length === 3 && key[0] >= 0 &&
    isCursorTimestamp(key[1]) && typeof key[2] === 'string' && !key[2].includes('\0')
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new RequestError('BAD_ENVELOPE')
  const bytes = Buffer.from(cursor, 'base64url')
  if (bytes.toString('base64url') !== cursor) throw new RequestError('BAD_ENVELOPE')
  let decoded
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new RequestError('BAD_ENVELOPE')
  }
  if (!decoded || Object.keys(decoded).length !== 2 || !isCursorKey(decoded.stream, decoded.key)) {
    throw new RequestError('BAD_ENVELOPE')
  }
  return decoded
}

export function encodeCursor(stream, row) {
  const key = stream === 'operations' ? [row.class_seq] : [row.class_seq ?? 0, row.occurred_at, row.transaction_id]
  return Buffer.from(JSON.stringify({ stream, key })).toString('base64url')
}
