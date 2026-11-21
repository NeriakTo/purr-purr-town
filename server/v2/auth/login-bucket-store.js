import { readQuery, writeTransaction } from '../db.js'

async function lockBucket(client, key, create) {
  if (create) {
    await client.query(`
      INSERT INTO ppt_web_state.login_buckets (bucket_key) VALUES ($1)
      ON CONFLICT (bucket_key) DO NOTHING
    `, [key])
  }
  const { rows: [bucket] } = await client.query(`
    SELECT failures, lease_expires_at FROM ppt_web_state.login_buckets
    WHERE bucket_key = $1 FOR UPDATE
  `, [key])
  return bucket
}

function deleteQueueTicket(client, key, ticket) {
  return client.query('DELETE FROM ppt_web_state.login_queue WHERE bucket_key = $1 AND ticket = $2', [key, ticket])
}

async function takeLease(client, key, ticket, options, bucket, now, slotWaitMs) {
  const { delaysMs, failureThreshold, leaseMs } = options
  const delayIndex = Math.min(bucket.failures - failureThreshold, delaysMs.length - 1)
  const delay = delaysMs[delayIndex] ?? 0
  const expiresAt = new Date(now.getTime() + delay + slotWaitMs + leaseMs)
  const { rows: [{ lease_number: number }] } = await client.query(`
    UPDATE ppt_web_state.login_buckets SET lease_expires_at = $2, lease_number = lease_number + 1
    WHERE bucket_key = $1 RETURNING lease_number
  `, [key, expiresAt])
  if (ticket) await deleteQueueTicket(client, key, ticket)
  return { lease: { number, expiresAt, delay } }
}

async function enqueue(client, key, deadline) {
  const { rows: [{ next_ticket: ticket }] } = await client.query(`
    UPDATE ppt_web_state.login_buckets SET next_ticket = next_ticket + 1
    WHERE bucket_key = $1 RETURNING next_ticket
  `, [key])
  await client.query(`
    INSERT INTO ppt_web_state.login_queue (bucket_key, ticket, expires_at)
    VALUES ($1, $2, $3)
  `, [key, ticket, deadline])
  return { ticket, deadline }
}

export function createLoginBucketStore({ pool, config, clock }, options) {
  function tryAcquire(key, slotWaitMs, waiting, reserveWaiter) {
    return writeTransaction(pool, config, async client => {
      const bucket = await lockBucket(client, key, !waiting)
      const now = clock()
      if (!bucket) return {}
      await client.query(`
        DELETE FROM ppt_web_state.login_queue WHERE bucket_key = $1 AND expires_at <= $2
      `, [key, now])
      if (waiting && waiting.deadline <= now) return {}

      const { rows: queue } = await client.query(`
        SELECT ticket FROM ppt_web_state.login_queue WHERE bucket_key = $1 ORDER BY ticket
      `, [key])
      const holdsTurn = waiting ? queue[0]?.ticket === waiting.ticket : queue.length === 0
      if (holdsTurn && (bucket.lease_expires_at === null || bucket.lease_expires_at <= now)) {
        return takeLease(client, key, waiting?.ticket, options, bucket, clock(), slotWaitMs)
      }
      if (waiting) return waiting
      if (queue.length >= options.queueLimit || !reserveWaiter()) return {}
      return enqueue(client, key, new Date(now.getTime() + options.queueWaitMs))
    })
  }

  async function completeLease(key, lease, verified) {
    const { rowCount } = await readQuery(pool, `
      UPDATE ppt_web_state.login_buckets
      SET lease_expires_at = NULL,
          failures = CASE $3::boolean WHEN true THEN 0
            WHEN false THEN LEAST(failures::bigint + 1, 2147483647) ELSE failures END,
          last_failure_at = CASE WHEN $3 IS FALSE THEN $4 ELSE last_failure_at END
      WHERE bucket_key = $1 AND lease_number = $2 AND lease_expires_at IS NOT NULL
        AND ($3::boolean IS NULL OR lease_expires_at > $4)
    `, [key, lease.number, verified, clock()])
    return rowCount === 1
  }

  function removeTicket(key, ticket) {
    return readQuery(pool, 'DELETE FROM ppt_web_state.login_queue WHERE bucket_key = $1 AND ticket = $2', [key, ticket])
  }

  function recordBusy(name) {
    // PostgreSQL text 無法保存 NUL 與單獨的 UTF-16 代理碼，這類名稱改存可逆的 JSON 表示。
    const storedName = name.includes('\u0000') || name.startsWith('\\') || !name.isWellFormed()
      ? '\\' + JSON.stringify(name)
      : name
    return readQuery(pool, `
      INSERT INTO ppt_web_state.bucket_busy_counts AS counts (name, count, last_at) VALUES ($1, 1, $2)
      ON CONFLICT (name) DO UPDATE SET count = counts.count + 1, last_at = GREATEST(counts.last_at, EXCLUDED.last_at)
    `, [storedName, clock()])
  }

  return { tryAcquire, completeLease, removeTicket, recordBusy }
}
