import { buildV2App } from '../app.js'

export function createTestApp(database, { pool = database.createPool(), ...options } = {}) {
  return buildV2App({ pool, ...options })
}
