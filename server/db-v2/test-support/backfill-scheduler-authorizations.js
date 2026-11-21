import { readFile } from 'node:fs/promises'

export async function backfillSchedulerAuthorizations(client) {
  const file = new URL('../maintenance/backfill-scheduler-authorizations.sql', import.meta.url)
  const sql = await readFile(file, 'utf8')
  return client.query(sql)
}
