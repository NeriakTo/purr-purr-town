import { writeTransaction } from '../db.js'
import { readCleanupConfig } from './config.js'

const queueGraceMs = 5 * 60 * 1000

function deleteExpiredRows(pool, config, sql, cutoff) {
  return writeTransaction(pool, config, async function deleteWithCutoff(client) {
    const { rowCount } = await client.query(sql, [cutoff])
    return rowCount
  })
}

export async function cleanWebState({ pool, config, clock, logger }) {
  const { sessionRetentionMs, busyCountRetentionMs } = readCleanupConfig(config.cleanup)
  const now = clock().getTime()

  // PostgreSQL 的 LEAST 忽略 NULL，未經 GAS 的工作階段以 expires_at 到期。
  const sessions = await deleteExpiredRows(pool, config, `
    DELETE FROM ppt_web_state.sessions
    WHERE LEAST(expires_at, first_relayed_at + INTERVAL '24 hours') < $1
  `, new Date(now - sessionRetentionMs))
  const loginQueue = await deleteExpiredRows(pool, config, `
    DELETE FROM ppt_web_state.login_queue WHERE expires_at < $1
  `, new Date(now - queueGraceMs))
  const busyCounts = await deleteExpiredRows(pool, config, `
    DELETE FROM ppt_web_state.bucket_busy_counts WHERE last_at < $1
  `, new Date(now - busyCountRetentionMs))

  logger.info({ sessions, login_queue: loginQueue, bucket_busy_counts: busyCounts })
}
