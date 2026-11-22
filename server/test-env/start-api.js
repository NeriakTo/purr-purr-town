import { ConfigError, isEntryPoint, readSecret } from './secrets.js'

export function buildDatabaseUrl(base, password) {
  try {
    const url = new URL(base)
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname
      || !url.username || url.password || url.searchParams.has('password')) {
      throw new Error()
    }
    url.password = encodeURIComponent(password)
    return url.href
  } catch {
    throw new ConfigError('DATABASE_URL_INVALID')
  }
}

async function main() {
  const password = await readSecret('PPT_V2_DATABASE_PASSWORD_FILE')
  process.env.PPT_V2_DATABASE_URL = buildDatabaseUrl(process.env.PPT_V2_DATABASE_URL_NO_PASSWORD, password)
  await import('../v2/index.js')
}

if (isEntryPoint(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'STARTUP_FAILED')
    process.exitCode = 1
  }
}
