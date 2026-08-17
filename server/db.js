import pg from 'pg'

const { Pool } = pg

if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD environment variable is required')
}

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'purr_purr_town',
  user: process.env.DB_USER || 'purrtown',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000
})

export async function query(text, params) {
  const result = await pool.query(text, params)
  return result
}

export default pool
