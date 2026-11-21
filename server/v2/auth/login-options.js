const defaults = {
  failureThreshold: 5,
  delaysMs: [1000, 2000, 4000, 8000],
  queueLimit: 3,
  queueWaitMs: 30000,
  pollMs: 200,
  leaseMs: 10000,
  maxWaiters: 50,
  verifySlots: 3,
  threadPoolSize: 4,
  anonymousInFlightPerRoute: 16,
  anonymousQueuePerRoute: 8,
  anonymousSlotWaitMs: 2000,
  markedQueueLimit: 64,
  markedSlotWaitMs: 5000,
}

function integerAtLeast(value, minimum) {
  return Number.isInteger(value) && value >= minimum && value <= 2147483647
}

export function readLoginOptions(login) {
  const options = { ...defaults, ...login }
  if (!['failureThreshold', 'queueLimit', 'maxWaiters'].every(key => integerAtLeast(options[key], 0))
    || !['queueWaitMs', 'pollMs', 'leaseMs'].every(key => integerAtLeast(options[key], 1))
    || !Array.isArray(options.delaysMs) || options.delaysMs.length === 0
    || !options.delaysMs.every(delay => integerAtLeast(delay, 0))) {
    throw new RangeError('登入桶的延遲、排隊與租約設定無效')
  }
  if (!integerAtLeast(options.verifySlots, 3) || !integerAtLeast(options.threadPoolSize, 4)
    || options.verifySlots >= options.threadPoolSize) {
    throw new RangeError('密碼比對位置須至少三個，且須保留至少一條執行緒')
  }
  if (!['anonymousInFlightPerRoute', 'anonymousQueuePerRoute', 'markedQueueLimit']
    .every(key => integerAtLeast(options[key], 0))
    || !['anonymousSlotWaitMs', 'markedSlotWaitMs'].every(key => integerAtLeast(options[key], 1))) {
    throw new RangeError('登入的同時處理、等位置隊伍或等待期限設定無效')
  }
  const extraTime = options.markedSlotWaitMs + options.leaseMs
  if (options.delaysMs.some(delay => delay + extraTime >= options.queueWaitMs)) {
    throw new RangeError('登入桶的最大延遲、帶標記等位置上限與比對租約合計須小於桶的排隊期限')
  }
  return options
}
