import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { expect, test } from 'vitest'
import { readSecret } from './secrets.js'
import { buildDatabaseUrl } from './start-api.js'

const variable = 'PPT_V2_DATABASE_PASSWORD_FILE'

async function withSecret(content, work) {
  const directory = await mkdtemp(fileURLToPath(new URL('./.secret-test-', import.meta.url)))
  try {
    const path = join(directory, 'secret')
    await writeFile(path, content)
    await work({ [variable]: path })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('連線字串可讓 pg 還原特殊字元', () => {
  const password = ['@', ':', '/', '%', '2F', ' '].join('')
  const url = buildDatabaseUrl('postgresql://ppt_web@db:5432/ppt_test', password)
  const { connectionParameters } = new pg.Client({ connectionString: url })
  expect(connectionParameters.password).toBe(password)
  expect(connectionParameters.database).toBe('ppt_test')
})

test('拒絕已含密碼的連線字串', () => {
  expect(() => buildDatabaseUrl('postgresql://ppt_web:x@db/ppt_test', 'y')).toThrow('DATABASE_URL_INVALID')
  expect(() => buildDatabaseUrl('postgresql://ppt_web@db/ppt_test?password=x', 'y')).toThrow('DATABASE_URL_INVALID')
})

test('秘密檔只移除結尾換行', async () => {
  await withSecret(' space \r\n\n', async env => {
    await expect(readSecret(variable, env)).resolves.toBe(' space ')
  })
})

test('秘密檔為空時回報變數名', async () => {
  await withSecret('\r\n', async env => {
    await expect(readSecret(variable, env)).rejects.toThrow('SECRET_EMPTY ' + variable)
  })
})

test('秘密檔讀不到時只回報變數名與錯誤碼', async () => {
  await expect(readSecret(variable, { [variable]: '/nonexistent/secret-file' }))
    .rejects.toThrow(new Error('SECRET_UNREADABLE ' + variable))
})
