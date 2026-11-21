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

export function readBackgroundConfig(config = {}) {
  return {
    ...config,
    jobs: { intervalMs: integerSetting(config.jobs?.intervalMs, 600000, 60000, 3600000, 'jobs.intervalMs') },
    cleanup: readCleanupConfig(config.cleanup),
  }
}

export function validateTimers(timers) {
  if (typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') {
    throw new RangeError('timers 必須提供 setTimeout 與 clearTimeout')
  }
}
