import { rateLimitError } from '../errors.js'

export function loginCategory(marker, relayed) {
  if (marker) return 'marked'
  return relayed ? 'gas' : 'direct'
}

export function createLoginRejections(app, route, schedule) {
  let counts = { marked: 0, gas: 0, direct: 0 }
  let cancelFlush

  function flush() {
    const summary = counts
    counts = { marked: 0, gas: 0, direct: 0 }
    cancelFlush = undefined
    app.log.warn({ route, code: 'RATE_LIMITED', ...summary })
  }

  app.addHook('onClose', async () => cancelFlush?.())

  return function rejectLogin(category) {
    counts[category] += 1
    cancelFlush ??= schedule(flush, 60000)
    throw rateLimitError(5)
  }
}

export function createLoginAdmission({ clock }, options, scheduleDeadline) {
  const accounts = new Map()
  const anonymousInFlight = { gas: 0, direct: 0 }

  function admitAnonymous(category) {
    if (anonymousInFlight[category] >= options.anonymousInFlightPerRoute) return null
    anonymousInFlight[category] += 1
    return () => { anonymousInFlight[category] -= 1 }
  }

  function admitMarked(id) {
    const active = accounts.get(id)
    if (!active) {
      const entry = { waiting: null }
      accounts.set(id, entry)
      return () => releaseMarked(id, entry)
    }
    if (active.waiting) return null

    const { promise, resolve } = Promise.withResolvers()
    const deadline = clock().getTime() + options.markedSlotWaitMs
    const waiter = { resolve, deadline }
    active.waiting = waiter
    waiter.cancel = scheduleDeadline(deadline, expire)
    return promise

    function expire() {
      active.waiting = null
      resolve(null)
    }
  }

  function releaseMarked(id, entry) {
    const waiter = entry.waiting
    entry.waiting = null
    if (waiter) {
      waiter.cancel()
      if (clock().getTime() < waiter.deadline) {
        waiter.resolve(() => releaseMarked(id, entry))
        return
      }
      waiter.resolve(null)
    }
    accounts.delete(id)
  }

  return function admitLogin(category, teacher) {
    return category === 'marked' ? admitMarked(teacher.id) : admitAnonymous(category)
  }
}
