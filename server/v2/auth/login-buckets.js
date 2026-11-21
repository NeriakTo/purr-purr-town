import { hashSessionToken } from './session.js'
import { rateLimitError, RequestError } from '../errors.js'
import { createLoginBucketStore } from './login-bucket-store.js'

const noVerifySlot = Symbol('沒有可用的比對位置')

function bucketKey({ name, marker, relayed, ip }) {
  if (marker) return hashSessionToken(JSON.stringify(['device', hashSessionToken(marker)]))
  if (relayed) return hashSessionToken(JSON.stringify(['gas', name]))
  return hashSessionToken(JSON.stringify(['direct', ip, name]))
}

export function createLoginBuckets(context, options, { acquireSlot, scheduleDeadline, rejectLogin }) {
  const { sleep, clock } = context
  const store = createLoginBucketStore(context, options)
  let waiterCount = 0

  async function acquireLease(key, slotWaitMs) {
    let waiting
    let reserved = false

    function reserveWaiter() {
      if (waiterCount >= options.maxWaiters) return false
      waiterCount += 1
      reserved = true
      return true
    }

    try {
      let result = await store.tryAcquire(key, slotWaitMs, undefined, reserveWaiter)
      while (result.ticket !== undefined) {
        waiting = result
        const remaining = waiting.deadline.getTime() - clock().getTime()
        if (remaining > 0) await sleep(Math.min(options.pollMs, remaining))
        result = await store.tryAcquire(key, slotWaitMs, waiting)
      }
      return result.lease
    } catch (error) {
      if (waiting) await store.removeTicket(key, waiting.ticket)
      throw error
    } finally {
      if (reserved) waiterCount -= 1
    }
  }

  async function compareBeforeExpiry(verify, release, expiresAt) {
    const { promise: expired, reject } = Promise.withResolvers()
    const cancel = scheduleDeadline(expiresAt, () => reject(new RequestError('SERVER_BUSY')))
    try {
      return await Promise.race([compare(), expired])
    } finally {
      cancel()
    }

    async function compare() {
      try {
        return await verify()
      } finally {
        release()
      }
    }
  }

  async function compareInSlot({ category, teacher }, lease, verify) {
    const expiresAt = lease.expiresAt.getTime()
    const deadline = expiresAt - options.leaseMs
    const release = await acquireSlot(category, teacher, deadline)
    if (!release) return noVerifySlot
    if (clock().getTime() >= deadline) {
      release()
      return noVerifySlot
    }
    return compareBeforeExpiry(verify, release, expiresAt)
  }

  async function verifyWithLease(key, lease, attempt, check) {
    let verified = null
    let accepted
    try {
      if (lease.delay > 0) await sleep(lease.delay)
      if (clock() < lease.expiresAt) verified = await check(verify => compareInSlot(attempt, lease, verify))
    } finally {
      accepted = await store.completeLease(key, lease, verified === noVerifySlot ? null : verified)
    }
    if (verified === noVerifySlot) rejectLogin(attempt.category)
    if (!accepted || verified === null) throw new RequestError('SERVER_BUSY')
    return verified
  }

  return async function verifyInBucket(attempt, check) {
    const key = bucketKey(attempt)
    const slotWaitMs = attempt.category === 'marked' ? options.markedSlotWaitMs : options.anonymousSlotWaitMs
    const lease = await acquireLease(key, slotWaitMs)
    if (lease) return verifyWithLease(key, lease, attempt, check)
    await store.recordBusy(attempt.name)
    throw rateLimitError(30, 'bucket_busy')
  }
}
