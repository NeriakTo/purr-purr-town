import { isIP } from 'node:net'
import { RequestError } from './errors.js'

function isProxyAddress(entry) {
  if (typeof entry !== 'string') return false
  const [address, prefix, extra] = entry.split('/')
  const family = isIP(address)
  if (!family || extra !== undefined) return false
  if (prefix === undefined) return true
  return /^[1-9][0-9]*$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)
}

export function readTrustProxy(value) {
  if (value === undefined || value === false) return false
  if (Array.isArray(value) && value.every(isProxyAddress)) return value.length ? value : false
  throw new TypeError('trustProxy 須為 false 或代理位址與非全網段 CIDR 的陣列')
}

export function createOriginCheck(allowedOrigins, isGasRelay) {
  return async function checkOrigin(request) {
    const { origin } = request.headers
    if (request.method === 'OPTIONS' || origin === undefined || allowedOrigins.includes(origin)) return
    if (!isGasRelay(request.headers)) throw new RequestError('ORIGIN_FORBIDDEN')
  }
}
