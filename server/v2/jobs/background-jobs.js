import { RequestError } from '../errors.js'
import { defaultTimers, readBackgroundConfig, validateTimers } from './config.js'
import { createCorrectionOverdueJob } from './correction-overdue.js'
import { taiwanJobTime } from './taiwan-time.js'
import { cleanWebState } from './web-state-cleanup.js'

export function createBackgroundJobList() {
  return [
    { name: 'correction_overdue', run: createCorrectionOverdueJob() },
    { name: 'web_state_cleanup', run: cleanWebState },
  ]
}

export function startBackgroundJobs(app, options = {}) {
  const {
    pool, config, clock = () => new Date(), timers = defaultTimers, hooks, jobs = [],
  } = { ...app.backgroundJobContext, ...options }
  const settings = readBackgroundConfig(config)
  validateTimers(timers)

  const logger = app.log
  const context = { pool, config: settings, clock, timers, logger, hooks }
  let activeRound
  let timer = null
  let stopped = false

  async function runRound() {
    for (const { name, run } of jobs) {
      try {
        await run(context)
      } catch (error) {
        const code = error instanceof RequestError && error.code === 'SERVER_BUSY' ? error.code : 'INTERNAL_ERROR'
        logger.error({ job: name, code })
      }
    }
  }

  function scheduleNextRound() {
    if (stopped) return
    const delay = Math.min(settings.jobs.intervalMs, taiwanJobTime(clock()).untilNextRunMs)
    timer = timers.setTimeout(onTimer, delay)
  }

  function startRound() {
    activeRound = runRound().then(scheduleNextRound)
    return activeRound
  }

  function onTimer() {
    timer = null
    if (!stopped) return startRound()
  }

  async function stop() {
    stopped = true
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
    await activeRound
  }

  startRound()
  return { stop }
}
