import { hashSessionToken } from './session.js'
import { rateLimitError, RequestError } from '../errors.js'
import { createLoginBucketStore } from './login-bucket-store.js'

const defaults = {
  failureThreshold: 5,
  delaysMs: [1000, 2000, 4000, 8000],
  queueLimit: 3,
  queueWaitMs: 30000,
  pollMs: 200,
  leaseMs: 10000,
  maxWaiters: 50,
}

function readBucketOptions(login) {
  const options = { ...defaults, ...login }
  function integerAtLeast(value, minimum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= 2147483647
  }
  if (!['failureThreshold', 'queueLimit', 'maxWaiters'].every(key => integerAtLeast(options[key], 0))
    || !['queueWaitMs', 'pollMs', 'leaseMs'].every(key => integerAtLeast(options[key], 1))
    || !Array.isArray(options.delaysMs) || options.delaysMs.length === 0
    || !options.delaysMs.every(delay => integerAtLeast(delay, 0))) {
    throw new RangeError('登入桶的延遲、排隊與租約設定無效')
  }
  return options
}

function bucketKey({ name, marker, relayed, ip }) {
  if (marker) return hashSessionToken(JSON.stringify(['device', hashSessionToken(marker)]))
  if (relayed) return hashSessionToken(JSON.stringify(['gas', name]))
  return hashSessionToken(JSON.stringify(['direct', ip, name]))
}

export function createLoginBuckets(context) {
  const { config, sleep, clock } = context
  const options = readBucketOptions(config.login)
  const store = createLoginBucketStore(context, options)
  let waiterCount = 0

  async function acquireLease(key) {
    let waiting
    let reserved = false

    function reserveWaiter() {
      if (waiterCount >= options.maxWaiters) return false
      waiterCount += 1
      reserved = true
      return true
    }

    try {
      let result = await store.tryAcquire(key, undefined, reserveWaiter)
      while (result.ticket !== undefined) {
        waiting = result
        const remaining = waiting.deadline.getTime() - clock().getTime()
        if (remaining > 0) await sleep(Math.min(options.pollMs, remaining))
        result = await store.tryAcquire(key, waiting)
      }
      return result.lease
    } catch (error) {
      if (waiting) await store.removeTicket(key, waiting.ticket)
      throw error
    } finally {
      if (reserved) waiterCount -= 1
    }
  }

  async function verifyWithLease(key, lease, verify) {
    let verified = null
    let accepted
    try {
      if (lease.delay > 0) await sleep(lease.delay)
      if (clock() < lease.expiresAt) verified = await verify()
    } finally {
      accepted = await store.completeLease(key, lease, verified)
    }
    if (!accepted || verified === null) throw new RequestError('SERVER_BUSY')
    return verified
  }

  return async function verifyInBucket(attempt, verify) {
    const key = bucketKey(attempt)
    const lease = await acquireLease(key)
    if (lease) return verifyWithLease(key, lease, verify)
    await store.recordBusy(attempt.name)
    throw rateLimitError(30, 'bucket_busy')
  }
}
