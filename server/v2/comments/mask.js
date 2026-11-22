const whitespace = '[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]'
const whitespacePattern = new RegExp(whitespace, 'gu')

function normalizeSpelling(name) {
  return name.replace(whitespacePattern, '').toLowerCase()
}

function spellings(name) {
  const compact = normalizeSpelling(name)
  const characters = [...compact]
  if (!characters.length) return []
  const variants = [compact]
  if (characters.length >= 3) variants.push(characters.slice(1).join(''))
  if (characters.length >= 4) variants.push(characters.slice(-2).join(''))
  return variants
}

function groupSpellings(roster) {
  const groups = new Map()
  for (const student of roster) {
    if (typeof student.name !== 'string' || (student.seat_number !== null && !Number.isInteger(student.seat_number))) {
      throw new TypeError('評語名冊的姓名或座號格式不符')
    }
    for (const spelling of spellings(student.name)) {
      if (!groups.has(spelling)) groups.set(spelling, [])
      groups.get(spelling).push(student)
    }
  }
  return groups
}

export function studentLabel(seatNumber) {
  return seatNumber === null ? '座號未定' : seatNumber + '號'
}

function sharedLabel(students) {
  if (students.length >= 4) return '某位同學'
  return students.map(student => student.seat_number)
    .sort((left, right) => (left ?? Infinity) - (right ?? Infinity))
    .map(studentLabel)
    .join('或')
}

function spellingCharacter(character) {
  return character.replace(/[.*+?^$(){}|[\]\\]/gu, '\\$&')
}

export function maskObservation(observation, roster) {
  const groups = groupSpellings(roster)
  if (groups.size === 0) return observation

  // 全域比對先取最早的位置，再依交替式的順序取同一位置的最長拼法。
  const alternatives = Array.from(groups.keys(), spelling => [...spelling])
    .sort((left, right) => right.length - left.length)
    .map(characters => characters.map(spellingCharacter).join(whitespace + '*'))
  const pattern = new RegExp(alternatives.join('|'), 'giu')

  let result = ''
  let position = 0
  for (const { 0: matched, index } of observation.matchAll(pattern)) {
    const students = groups.get(normalizeSpelling(matched))
    if (!students) return '（遮罩失敗）'
    result += observation.slice(position, index) + sharedLabel(students)
    position = index + matched.length
  }
  return result + observation.slice(position)
}

export function restoreStudentName(text, target, roster) {
  if (target.seat_number === null) return text
  const groups = groupSpellings(roster)
  const targetSpellings = spellings(target.name)
  if (!targetSpellings.length || targetSpellings.some(spelling => groups.get(spelling)?.length > 1)) return text
  const label = new RegExp('(?<!\\p{Nd})' + studentLabel(target.seat_number), 'gu')
  return text.replace(label, () => target.name)
}
