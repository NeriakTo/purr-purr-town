import { clearTimeout, setTimeout } from 'node:timers'

export const defaultTimers = Object.freeze({ setTimeout, clearTimeout })
const dayMs = 24 * 60 * 60 * 1000

function integerSetting(value, fallback, min, max, name) {
  const setting = value === undefined ? fallback : value
  if (!Number.isInteger(setting) || setting < min || setting > max) {
    throw new RangeError(`${name} 必須是 ${min} 到 ${max} 的整數`)
  }
  return setting
}

export function readCleanupConfig(cleanup) {
  const minimum = dayMs
  const maximum = 365 * dayMs
  const fallback = 30 * dayMs
  return {
    sessionRetentionMs: integerSetting(cleanup?.sessionRetentionMs, fallback, minimum, maximum, 'cleanup.sessionRetentionMs'),
    busyCountRetentionMs: integerSetting(cleanup?.busyCountRetentionMs, fallback, minimum, maximum, 'cleanup.busyCountRetentionMs'),
  }
}

function readCommentsConfig(config) {
  const { comments } = config
  const timeoutMs = integerSetting(comments?.timeoutMs, 120000, 1000, 600000, 'comments.timeoutMs')
  const configuredDelays = comments?.retryDelaysMs
  const delays = configuredDelays === undefined ? [1000, 2000, 4000] : configuredDelays
  if (!Array.isArray(delays) || delays.length > 5
    || [...delays].some(delay => !Number.isInteger(delay) || delay < 0 || delay > 60000)) {
    throw new RangeError('comments.retryDelaysMs 最多五項，每項必須是 0 到 60000 的整數')
  }
  const retryDelaysMs = [...delays]
  const minimum = timeoutMs + retryDelaysMs.reduce((total, delay) => total + delay, 0)
    + 4 * (config.statementTimeoutMs ?? 30000)
  const sweepAfterMs = comments?.sweepAfterMs === undefined ? 600000 : comments.sweepAfterMs
  if (!Number.isSafeInteger(sweepAfterMs) || !(sweepAfterMs > minimum)) {
    throw new RangeError('comments.sweepAfterMs 必須大於評語逾時、重送等待總和和四倍語句逾時之總和')
  }
  return { timeoutMs, retryDelaysMs, sweepAfterMs }
}

export function readBackgroundConfig(config = {}) {
  return {
    ...config,
    jobs: { intervalMs: integerSetting(config.jobs?.intervalMs, 600000, 60000, 3600000, 'jobs.intervalMs') },
    cleanup: readCleanupConfig(config.cleanup),
    comments: readCommentsConfig(config),
  }
}

export function validateTimers(timers) {
  if (typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') {
    throw new RangeError('timers 必須提供 setTimeout 與 clearTimeout')
  }
}
