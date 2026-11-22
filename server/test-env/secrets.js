import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export class ConfigError extends Error {}

export async function readSecret(variable, env = process.env) {
  let contents
  try {
    contents = await readFile(env[variable], 'utf8')
  } catch {
    throw new ConfigError('SECRET_UNREADABLE ' + variable)
  }
  const secret = contents.replace(/[\r\n]+$/, '')
  if (!secret) throw new ConfigError('SECRET_EMPTY ' + variable)
  return secret
}

export function isEntryPoint(url) {
  return Boolean(process.argv[1]) && url === pathToFileURL(process.argv[1]).href
}
