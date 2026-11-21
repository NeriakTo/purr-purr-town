import { buildV2App } from '../app.js'

export function createTestApp(database, options = {}) {
  return buildV2App({ pool: database.createPool(), ...options })
}
