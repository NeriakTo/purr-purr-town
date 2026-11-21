function readInteger(value, fallback, upper, name) {
  const setting = value === undefined ? fallback : value
  if (!Number.isInteger(setting) || setting < 1 || setting > upper) {
    throw new RangeError(`${name} 必須是 1 到 ${upper} 的整數`)
  }
  return setting
}

export function readConfig(read = {}) {
  return {
    pageSize: readInteger(read.pageSize, 500, 2000, 'read.pageSize'),
    changesFullThreshold: readInteger(read.changesFullThreshold, 500, 100000, 'read.changesFullThreshold'),
  }
}
