import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { install } from '../install.js'

const { Client } = pg
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

function localClient(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 })
  if (!loopbackHosts.has(client.connectionParameters.host)) {
    throw new Error('測試資料庫必須使用本機迴路位址')
  }
  return client
}

async function assertPostgres16(client) {
  const { rows: [{ server_version_num: version }] } = await client.query('SHOW server_version_num')
  if (Math.floor(Number(version) / 10000) !== 16) {
    throw new Error('測試資料庫必須使用 PostgreSQL 16')
  }
}

export async function openTestDatabase(url = process.env.PPT_TEST_DATABASE_URL) {
  if (!url) throw new Error('未設定 PPT_TEST_DATABASE_URL')
  const admin = localClient(url)
  const name = 'ppt_t604_' + randomUUID().replaceAll('-', '')
  const databaseUrl = new URL(url)
  databaseUrl.pathname = '/' + name
  databaseUrl.searchParams.delete('database')
  databaseUrl.searchParams.delete('dbname')

  const clients = new Set()
  let created = false

  async function connect() {
    const client = localClient(databaseUrl.toString())
    if (client.database !== name) throw new Error('測試連線未指向本測試建立的資料庫')
    clients.add(client)
    await client.connect()
    return client
  }

  async function close() {
    try {
      await Promise.all([...clients].map((client) => client.end()))
    } finally {
      try {
        if (created) await admin.query('DROP DATABASE ' + name)
      } finally {
        await admin.end()
      }
    }
  }

  try {
    await admin.connect()
    await assertPostgres16(admin)
    await admin.query('CREATE DATABASE ' + name)
    created = true
    const client = await connect()
    await install(client)
    return { name, client, connect, close }
  } catch (error) {
    await close()
    throw error
  }
}
