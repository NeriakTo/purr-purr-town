import { operation } from './schoolwork.js'

export function setSetting(classId, key, value, version = { rev: 0 }) {
  return operation(classId, 'setting.set', { key, value }, version)
}

export function currency(fish = 7, cookie = 1000) {
  return { base: {}, tier1: { rate: fish }, tier2: { rate: cookie } }
}
