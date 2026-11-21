import { readQuery } from '../db.js'
import { correctionOverdueId } from './operation-ids.js'
import { schedulerActor, submitAsServer } from './server-submit.js'
import { taiwanJobTime } from './taiwan-time.js'

const job = 'correction_overdue'

function outcome({ replayed, status, code }) {
  if (replayed === true) return 'replayed'
  if (status === 'committed') return 'committed'
  if (code === 'CLASS_FORBIDDEN') return 'forbidden'
  if (code === 'SERVER_BUSY' || code === 'INTERNAL_ERROR') return 'retry'
  return 'rejected'
}

function overdueOperation(classId, date) {
  return {
    op_id: correctionOverdueId(classId, date),
    class_id: classId,
    type: 'schedule.correction_overdue',
    payload: { date },
  }
}

export function createCorrectionOverdueJob() {
  let currentDate
  let finishedClasses

  return async function runCorrectionOverdue({ pool, config, clock, logger, hooks }) {
    const { date, due } = taiwanJobTime(clock())
    const counts = { job, date, committed: 0, replayed: 0, rejected: 0, forbidden: 0, retry: 0 }
    if (date !== currentDate) {
      currentDate = date
      finishedClasses = new Set()
    }
    if (!due) {
      logger.info(counts)
      return
    }

    const finished = finishedClasses
    const { rows } = await readQuery(pool, "SELECT class_id FROM ppt.classes WHERE status = 'active' ORDER BY class_id")
    for (const { class_id: classId } of rows) {
      if (finished.has(classId)) continue

      const receipt = await submitAsServer(pool, config, overdueOperation(classId, date), schedulerActor, hooks)
      const result = outcome(receipt)
      counts[result]++
      if (result !== 'retry') finished.add(classId)
      if (result !== 'committed' && result !== 'replayed') {
        logger.warn({ job, date, class_id: classId, code: receipt.code })
      }
    }
    logger.info(counts)
  }
}
