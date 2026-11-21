import { maskObservation, restoreStudentName, studentLabel } from './mask.js'

const errors = Object.freeze({
  GENERATION_TIMEOUT: '評語產生逾時，請重按產生',
  WALLE_FAILED: '評語產生失敗，請重按產生',
  WALLE_DISABLED: '評語產生功能尚未啟用',
  INVALID_GENERATED_RESULT: '產生結果不符格式，請重按產生',
})

const bounds = { comment: [0, 2000], motto: [0, 200], analysis: [0, 5000], model: [1, 100] }
const fieldNames = Object.keys(bounds)

function isBoundedText(value, [min, max]) {
  if (typeof value !== 'string' || value.length > max * 2 || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    return false
  }
  const length = [...value].length
  return length >= min && length <= max
}

function validatedOutput(value) {
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== fieldNames.length) return null
  const fields = {}
  for (const key of fieldNames) {
    if (!Object.hasOwn(value, key)) return null
    const field = value[key]
    if (!isBoundedText(field, bounds[key])) return null
    fields[key] = field
  }
  return fields
}

function restoreOutput({ comment, motto, analysis, model }, student, roster) {
  return {
    comment: restoreStudentName(comment, student, roster),
    motto: restoreStudentName(motto, student, roster),
    analysis: restoreStudentName(analysis, student, roster),
    model,
  }
}

function generationFailure(code) {
  return { code, fields: { error: errors[code] } }
}

export function raceWithAbort(work, signal) {
  if (signal.aborted) return Promise.resolve()
  const { promise, resolve } = Promise.withResolvers()
  function stopWaiting() {
    resolve()
  }
  signal.addEventListener('abort', stopWaiting, { once: true })
  const running = Promise.resolve().then(function runIfActive() {
    if (!signal.aborted) return work()
  })
  return Promise.race([running, promise]).finally(function removeAbortListener() {
    signal.removeEventListener('abort', stopWaiting)
  })
}

async function callWalle({ walle, timers, config }, input, shutdown) {
  const timeout = new AbortController()
  const signal = AbortSignal.any([shutdown, timeout.signal])
  const timer = timers.setTimeout(function abortWalle() {
    timeout.abort()
  }, config.comments.timeoutMs)
  try {
    const output = await raceWithAbort(function requestWalle() {
      return walle(input, { signal })
    }, signal)
    if (timeout.signal.aborted) return generationFailure('GENERATION_TIMEOUT')
    return { output }
  } catch {
    return generationFailure(timeout.signal.aborted ? 'GENERATION_TIMEOUT' : 'WALLE_FAILED')
  } finally {
    timers.clearTimeout(timer)
  }
}

export async function generateComment(context, record, student, shutdown) {
  if (!context.walle) return generationFailure('WALLE_DISABLED')
  const roster = record.roster
  const input = {
    observation: maskObservation(record.observation, roster),
    student_label: studentLabel(student.seat_number),
    comment_locked: record.locked_comment,
    motto_locked: record.locked_motto,
  }
  const response = await callWalle(context, input, shutdown)
  if (shutdown.aborted) return
  if (response.code) return response
  const output = validatedOutput(response.output)
  const fields = output && validatedOutput(restoreOutput(output, student, roster))
  return fields ? { fields } : generationFailure('INVALID_GENERATED_RESULT')
}
