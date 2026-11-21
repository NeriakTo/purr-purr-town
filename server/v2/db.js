import { RequestError } from './errors.js'

const connectionCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
  'EHOSTUNREACH', 'ERR_STREAM_DESTROYED', '57P01', '57P02', '57P03',
])

export function sqlState(error) {
  const code = error?.code
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) && /[0-9]/.test(code) ? code : undefined
}

function isConnectionError(error) {
  return connectionCodes.has(error?.code) || sqlState(error)?.startsWith('08')
    || /^Connection terminated(?: unexpectedly)?$/.test(error?.message)
}

export function classifyDatabaseError(error, phase) {
  const busy = phase !== 'commit' && (
    phase === 'connect' || isConnectionError(error) || ['55P03', '57014'].includes(error?.code)
  )
  return new RequestError(busy ? 'SERVER_BUSY' : 'INTERNAL_ERROR', sqlState(error))
}

async function acquireClient(pool) {
  try {
    return await pool.connect()
  } catch (error) {
    throw classifyDatabaseError(error, 'connect')
  }
}

export async function readQuery(pool, sql, params) {
  const client = await acquireClient(pool)
  let failure
  try {
    return await client.query(sql, params)
  } catch (error) {
    failure = classifyDatabaseError(error)
    throw failure
  } finally {
    client.release(failure)
  }
}

async function runTransaction(pool, begin, work) {
  const client = await acquireClient(pool)
  let phase = 'work'
  let failure
  try {
    await client.query(begin)
    const result = await work(client)
    phase = 'commit'
    const commit = await client.query('COMMIT')
    if (commit.command !== 'COMMIT') throw new Error('交易未提交')
    return result
  } catch (error) {
    failure = classifyDatabaseError(error, phase)
    try {
      await client.query('ROLLBACK')
    } catch {
      // 保留原始失敗的分類。連線會在 finally 丟棄。
    }
    throw failure
  } finally {
    client.release(failure)
  }
}

function timeoutMilliseconds(value) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new RangeError('逾時須為 PostgreSQL 支援的非負整數毫秒數')
  }
  return value
}

export function writeTransaction(pool, config, work) {
  const lockTimeout = timeoutMilliseconds(config.lockTimeoutMs ?? 5000)
  const statementTimeout = timeoutMilliseconds(config.statementTimeoutMs ?? 30000)
  return runTransaction(pool, 'BEGIN ISOLATION LEVEL READ COMMITTED', async client => {
    await client.query(`SET LOCAL lock_timeout = ${lockTimeout}`)
    await client.query(`SET LOCAL statement_timeout = ${statementTimeout}`)
    return work(client)
  })
}

export function readSnapshot(pool, work) {
  return runTransaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', work)
}
