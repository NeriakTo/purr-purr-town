import { rateLimitError } from '../errors.js'

const minuteMs = 60 * 1000

export function createAccountRateLimit(clock, limit = 120) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('accountRateLimit 須為正整數')
  }
  const counts = new Map()
  let windowStart

  return function countAccountRequest(teacherId) {
    const now = clock().getTime()
    const start = Math.floor(now / minuteMs) * minuteMs
    if (start !== windowStart) {
      counts.clear()
      windowStart = start
    }
    const used = counts.get(teacherId) ?? 0
    if (used >= limit) {
      throw rateLimitError(Math.ceil((start + minuteMs - now) / 1000))
    }
    counts.set(teacherId, used + 1)
  }
}
