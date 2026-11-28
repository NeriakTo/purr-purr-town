import { createHash } from 'node:crypto'

export const TABLES = ['migration_batches', 'migration_sources', 'legacy_ids', 'classes', 'students', 'accounts', 'transactions', 'inventory_items', 'comments', 'exempt_rules', 'logs', 'tasks', 'submissions', 'legacy_effects', 'settings_entries', 'products', 'jobs', 'job_assignments', 'daily_duties', 'seats', 'announcements', 'rules', 'groups', 'semesters']
export const pointer = v => String(v).replaceAll('~', '~0').replaceAll('/', '~1')
export function canonicalJson(value) {
  return JSON.stringify(value === undefined ? null : value, function sortedKeys(key, item) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
  })
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
export const statusOf = v => v === true ? 'on_time' : v === false || v === undefined ? 'pending' : ['on_time', 'late', 'missing', 'leave', 'exempt', 'makeup'].includes(v) ? v : 'unknown'
export const CONVERTER_VERSION = 'v2-1A-r5'

export function migrationBatchId(classKey, source, decisions) {
  return digest([CONVERTER_VERSION, classKey, source, decisions])
}
