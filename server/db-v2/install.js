import { readdir, readFile } from 'node:fs/promises'

const sqlDirectory = new URL('./sql/', import.meta.url)

export async function install(client) {
  const files = await readdir(sqlDirectory)
  for (const file of files.filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, sqlDirectory), 'utf8')
    await client.query(sql)
  }
}
