import { describe, expect, test } from 'vitest'
import { maskObservation, restoreStudentName } from './comments/mask.js'

function student(name, seat_number, enrollment_status = 'enrolled') {
  return { name, seat_number, enrollment_status }
}

describe('評語遮名', () => {
  test('遮掉三種姓名拼法與字間空白，保留兩字姓名的單字', () => {
    const roster = [student('假測樣甲', 3), student('虛乙', 5)]
    const input = '假測樣甲／測樣甲／樣甲／假 測樣甲／假　測樣甲／假\t測\n樣甲／虛乙／乙'
    expect(maskObservation(input, roster)).toBe('3號／3號／3號／3號／3號／3號／5號／乙')
  })

  test('只比對規定的 Unicode 空白且略過空白姓名', () => {
    const spaces = '\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'
    const roster = [student('假' + spaces + '測', 3), student(spaces, 8)]
    expect(maskObservation('假' + spaces + '測／假\uFEFF測', roster)).toBe('3號／假\uFEFF測')
    expect(maskObservation('保留' + spaces, [roster[1]])).toBe('保留' + spaces)
  })

  test('較長的拼法優先於重疊的短拼法', () => {
    const roster = [student('虛甲乙', 3), student('甲乙', 5), student('另虛', 6)]
    expect(maskObservation('虛甲乙、另虛甲乙', roster)).toBe('3號、另3號')
  })

  test('多位學生共用拼法時依座號列出代稱，四位以上合併', () => {
    const roster = [
      student('測試同名', 9), student('測試同名', 4),
      student('樣本無座', null), student('樣本無座', 2),
      student('甲甲假尾', 6), student('乙乙假尾', 7),
      student('丙丙假尾', 8), student('丁丁假尾', 10),
    ]
    expect(maskObservation('測試同名、樣本無座、假尾', roster)).toBe('4號或9號、2號或座號未定、某位同學')
  })

  test('轉出、封存與在家自學的姓名也遮名，空座號有固定代稱', () => {
    const roster = [
      student('測甲', 4, 'transferred'), student('測乙', null, 'archived'),
      student('測丙', 7, 'home_study'),
    ]
    expect(maskObservation('測甲、測乙、測丙', roster)).toBe('4號、座號未定、7號')
  })

  test('姓名的正規表示式符號按字面比對', () => {
    const roster = [student('A.B', 5), student('(假*', 6)]
    expect(maskObservation('AxB、A.B、x假、(假*', roster)).toBe('AxB、5號、x假、6號')
  })

  test('英文姓名大小寫與空白不影響比對與歧義判斷', () => {
    const roster = [student('Amy Chen', 3), student('aMY cHEN', 5)]
    expect(maskObservation('amy chen／AmyChen', roster)).toBe('3號或5號／3號或5號')
  })

  test('三十位假名學生的所有拼法都不出現在遮名後文字', () => {
    const roster = Array.from({ length: 28 }, (_, i) => student('測 試甲' + String.fromCodePoint(0x4e00 + i), i + 1))
    roster.push(student('Fake NameX', 29), student('樣本乙丙', 30))
    const spellings = roster.flatMap(({ name }) => {
      const joined = name.replaceAll(' ', '')
      return [joined, joined.slice(1), joined.slice(-2)]
    })
    const input = spellings.map(name => [...name].join('　\t')).join('、')
    const masked = maskObservation(input, roster).replace(/[\u3000\t ]/gu, '').toLowerCase()
    for (const spelling of spellings) expect(masked).not.toContain(spelling.toLowerCase())
  })

  test('只還原目標座號，無座號或共用拼法時保留代稱', () => {
    const target = student('假 測試甲', 3)
    const input = '3號很棒，13號和１3號也是'
    expect(restoreStudentName(input, target, [target])).toBe('假 測試甲很棒，13號和１3號也是')
    const unseated = student('虛乙', null)
    expect(restoreStudentName('座號未定', unseated, [unseated])).toBe('座號未定')
    expect(restoreStudentName(input, target, [target, student('假樣試甲', 8)])).toBe(input)
  })
})
