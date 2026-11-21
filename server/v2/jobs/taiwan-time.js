const minuteMs = 60 * 1000
const dayMs = 24 * 60 * minuteMs
const taiwanOffsetMs = 8 * 60 * minuteMs
const correctionRunAtMs = 10 * minuteMs

export function taiwanJobTime(now) {
  const shifted = new Date(now.getTime() + taiwanOffsetMs)
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  const sinceMidnight = minutes * minuteMs + shifted.getUTCSeconds() * 1000 + shifted.getUTCMilliseconds()
  const untilTodayRun = correctionRunAtMs - sinceMidnight
  return {
    date: shifted.toISOString().slice(0, 10),
    due: untilTodayRun <= 0,
    untilNextRunMs: untilTodayRun > 0 ? untilTodayRun : dayMs + untilTodayRun,
  }
}
