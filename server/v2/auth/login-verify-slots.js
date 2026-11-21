const categories = ['marked', 'gas', 'direct']

function earlierRequest(left, right) {
  return left.sequence - right.sequence
}

function earlierAccount(left, right) {
  const a = left.teacher
  const b = right.teacher
  if (a.created_at !== b.created_at) {
    if (a.created_at === null) return 1
    if (b.created_at === null) return -1
    return a.created_at < b.created_at ? -1 : 1
  }
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return earlierRequest(left, right)
}

export function createVerifySlots({ clock }, options, scheduleDeadline) {
  const active = { marked: 0, gas: 0, direct: 0 }
  const queues = { marked: [], gas: [], direct: [] }
  let nextSequence = 0

  function canUseSlot(category) {
    const anonymous = active.gas + active.direct
    return active.marked + anonymous < options.verifySlots
      && (category === 'marked' || anonymous < options.verifySlots - 1)
  }

  function reserveSlot(category) {
    active[category] += 1
    return function releaseSlot() {
      active[category] -= 1
      dispatch()
    }
  }

  function removeWaiter(queue, waiter) {
    queue.splice(queue.indexOf(waiter), 1)
    waiter.cancel?.()
    waiter.resolve(null)
  }

  function removeExpired(queue, now) {
    for (const waiter of queue.filter(waiter => waiter.deadline <= now)) removeWaiter(queue, waiter)
  }

  function dispatch() {
    const now = clock().getTime()
    const eligible = []
    for (const category of categories) {
      const queue = queues[category]
      removeExpired(queue, now)
      if (queue.length && canUseSlot(category)) eligible.push(category)
    }

    eligible.sort((left, right) => (
      Number(active[left] > 0) - Number(active[right] > 0)
      || earlierRequest(queues[left][0], queues[right][0])
    ))
    const category = eligible[0]
    if (category) {
      const waiter = queues[category].shift()
      waiter.cancel()
      waiter.resolve(reserveSlot(category))
    }
  }

  function enqueue(category, teacher, deadline) {
    const queue = queues[category]
    removeExpired(queue, clock().getTime())
    const marked = category === 'marked'
    const limit = marked ? options.markedQueueLimit : options.anonymousQueuePerRoute
    const { promise, resolve } = Promise.withResolvers()
    const waiter = { teacher, deadline, sequence: nextSequence++, resolve }
    if (queue.length >= limit) {
      const last = queue.at(-1)
      if (!marked || !last || earlierAccount(waiter, last) >= 0) return null
      removeWaiter(queue, last)
    }
    queue.push(waiter)
    if (marked) queue.sort(earlierAccount)
    waiter.cancel = scheduleDeadline(deadline, () => removeWaiter(queue, waiter))
    return promise
  }

  return function acquireSlot(category, teacher, deadline) {
    if (clock().getTime() >= deadline) return null
    if (canUseSlot(category)) return reserveSlot(category)
    return enqueue(category, teacher, deadline)
  }
}
