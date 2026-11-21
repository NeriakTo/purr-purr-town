const whitespace = '[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]'
const whitespacePattern = new RegExp(whitespace, 'gu')

function spellings(name) {
  const compact = name.replace(whitespacePattern, '').replace(/[A-Z]/gu, letter => letter.toLowerCase())
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
  if (/[a-z]/u.test(character)) return '[' + character + character.toUpperCase() + ']'
  return character.replace(/[.*+?^$(){}|[\]\\]/gu, '\\$&')
}

function compareSpellings(left, right) {
  return right.characters.length - left.characters.length
    || (left.spelling < right.spelling ? -1 : Number(left.spelling > right.spelling))
}

function matchingNames(observation, groups) {
  const matches = []
  const occupied = new Uint8Array(observation.length)
  const names = Array.from(groups, ([spelling, students]) => ({ spelling, students, characters: [...spelling] }))
  for (const { characters, students } of names.sort(compareSpellings)) {
    const pattern = characters.map(spellingCharacter).join(whitespace + '*')
    const label = sharedLabel(students)
    // 保留重疊候選，讓較長的拼法先佔位置。
    for (const match of observation.matchAll(new RegExp('(?=(' + pattern + '))', 'gu'))) {
      const start = match.index
      const end = start + match[1].length
      if (occupied.subarray(start, end).includes(1)) continue
      occupied.fill(1, start, end)
      matches.push({ start, end, label })
    }
  }
  return matches.sort((left, right) => left.start - right.start)
}

export function maskObservation(observation, roster) {
  let result = ''
  let position = 0
  for (const { start, end, label } of matchingNames(observation, groupSpellings(roster))) {
    result += observation.slice(position, start) + label
    position = end
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
