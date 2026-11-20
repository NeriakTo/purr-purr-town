export function semesterAt(date) {
  const timestamp = taipeiTimestamp(date)
  if (timestamp === null) return null
  const local = new Date(timestamp + 8 * 3600000).toISOString()
  const y = Number(local.slice(0, 4)), m = Number(local.slice(5, 7))
  return `${y - 1911 - (m < 8 ? 1 : 0)}-${m === 1 || m >= 8 ? 1 : 2}`
}

export function taipeiTimestamp(date) {
  if (typeof date !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(date)) return null
  const day = date.slice(0, 10)
  const calendarDate = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(calendarDate.getTime())) return null
  if (calendarDate.toISOString().slice(0, 10) !== day) return null
  let zoned = date
  if (date.length === 10) zoned = `${date}T00:00:00+08:00`
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(date)) zoned = `${date}+08:00`
  const timestamp = Date.parse(zoned)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function decisionInputError(decisions) {
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) return 'decisions 必須是物件'
  if (decisions.openingAdjustment === true && decisions.cutoverDate == null) return 'openingAdjustment 需要 cutoverDate'
  return null
}

export function requireDecisions(decisions) {
  const issue = decisionInputError(decisions)
  if (issue) throw new TypeError(issue)
}

export function validCutoverDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && taipeiTimestamp(value) !== null
}

export function resolveCurrentSemester(declared, updatedAt, { cutoverDate }, error = () => {}) {
  const hasCutover = cutoverDate !== undefined
  const validCutover = validCutoverDate(cutoverDate)
  if (hasCutover && !validCutover) error('INVALID_CUTOVER_DATE', '/decisions/cutoverDate', cutoverDate)
  if (declared !== undefined && declared !== null && declared !== '') {
    if (typeof declared === 'string' && /^\d+-[12]$/.test(declared)) return declared
    error('INVALID_CURRENT_SEMESTER', '/data/settings/currentSemester', declared)
    return null
  }
  if (hasCutover) return validCutover ? semesterAt(cutoverDate) : null
  const semester = semesterAt(updatedAt)
  if (semester === null) error('UNKNOWN_CURRENT_SEMESTER', '/data/updatedAt', updatedAt)
  return semester
}

export function selectedSemester(date, { semesterRule }) {
  return semesterRule === 'month' ? semesterAt(date) : null
}

export function validateTaskDate(date, decisions, path, error) {
  if (decisions.semesterRule !== 'month') {
    error('UNKNOWN_TASK_SEMESTER', path)
  } else if (taipeiTimestamp(date) === null) {
    error('INVALID_TASK_DATE', path, date)
  }
}

export function openingAdjustmentEnabled(decisions) {
  return decisions.openingAdjustment === true && validCutoverDate(decisions.cutoverDate)
}
