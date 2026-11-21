export function scheduleLoginTimeout(callback, ms) {
  const timer = setTimeout(callback, ms)
  timer.unref()
  return () => clearTimeout(timer)
}

export function createLoginDeadline(clock, schedule) {
  return function scheduleDeadline(deadline, callback) {
    let cancel
    function checkDeadline() {
      const remaining = deadline - clock().getTime()
      if (remaining > 0) {
        cancel = schedule(checkDeadline, Math.min(remaining, 2147483647))
      } else {
        callback()
      }
    }
    checkDeadline()
    return () => cancel?.()
  }
}
