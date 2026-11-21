import { expect, it } from 'vitest'
import { connectAsRole } from './test-support/roles.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function mask(client, text, roster) {
  const { rows: [{ masked }] } = await client.query(
    'SELECT ppt_agent.mask_student_names($1, $2::jsonb) AS masked',
    [text, JSON.stringify(roster)],
  )
  return masked
}

const cases = [
  ['遮完整、去姓與末兩字', '王小明、小明；歐陽小華、陽小華、小華', [
    { name: '王小明', seat_number: 3 }, { name: '歐陽小華', seat_number: 5 },
  ], '3號、3號；5號、5號、5號'],
  ['姓名內各種空白可忽略，保留其餘空白', 'Page 12  王 小明、王　小明、王\t小明、王\u00a0小明、王\n小明、王\u2028小明', [
    { name: '王\u0085 小\u2007明', seat_number: 3 },
  ], 'Page 12  3號、3號、3號、3號、3號、3號'],
  ['同一位置以較長的寫法優先', '歐陽小明', [
    { name: '陽小', seat_number: 8 }, { name: '歐陽小明', seat_number: 5 },
  ], '5號'],
  ['兩位撞名依座號排列', '小明', [
    { name: '王小明', seat_number: 12 }, { name: '陳小明', seat_number: 3 },
  ], '3號或12號'],
  ['三位撞名依座號排列', '小明', [
    { name: '王小明', seat_number: 12 }, { name: '林小明', seat_number: 9 }, { name: '陳小明', seat_number: 3 },
  ], '3號或9號或12號'],
  ['四位撞名統稱某位同學', '小明', [
    { name: '王小明', seat_number: 1 }, { name: '陳小明', seat_number: 2 },
    { name: '林小明', seat_number: 3 }, { name: '歐陽小明', seat_number: 4 },
  ], '某位同學'],
  ['整班預設名的村民末兩字撞名', '村民', [
    { name: '1號村民', seat_number: 1 }, { name: '2號村民', seat_number: 2 },
    { name: '3號村民', seat_number: 3 }, { name: '4號村民', seat_number: 4 },
  ], '某位同學'],
  ['預設村民末兩字撞名並可與假姓名共存', '村民，王小明', [
    { name: '1號村民', seat_number: 1 }, { name: '2號村民', seat_number: 2 },
    { name: '3號村民', seat_number: 3 }, { name: '4號村民', seat_number: 4 },
    { name: '王小明', seat_number: 5 },
  ], '某位同學，5號'],
  ['單一空座號和撞名空座號', '陳大文，小明', [
    { name: '陳大文', seat_number: null }, { name: '王小明', seat_number: null },
    { name: '陳小明', seat_number: 2 },
  ], '座號未定，2號或座號未定'],
  ['替換結果不再掃描', '甲乙丙', [
    { name: '甲乙丙', seat_number: 12 }, { name: '12', seat_number: 9 },
  ], '12號'],
  ['正規式特殊字元按字面比對', 'A.B AxB | . *( [ \\', [
    { name: 'A.B', seat_number: 2 }, { name: '*(', seat_number: 3 },
    { name: '[', seat_number: 4 }, { name: '\\', seat_number: 5 },
  ], '2號 AxB | . 3號 4號 5號'],
  ['英文忽略大小寫，略過空姓名並遮一字姓名', 'aMy  丁', [
    { name: 'Amy', seat_number: 7 }, { name: '', seat_number: 1 },
    { name: '\t　', seat_number: 2 }, { name: '丁', seat_number: 5 },
  ], '7號  5號'],
  ['空名單保留原文', '王 小明', [], '王 小明'],
  ['空文字回空值', null, [{ name: '王小明', seat_number: 1 }], null],
  ['拒絕物件名單', '原文', {}, '（遮罩失敗）'],
  ['拒絕缺姓名的項目', '原文', [{ seat_number: 1 }], '（遮罩失敗）'],
  ['拒絕非字串姓名', '原文', [{ name: 1, seat_number: 1 }], '（遮罩失敗）'],
  ['拒絕缺座號的項目', '原文', [{ name: '原文' }], '（遮罩失敗）'],
  ['拒絕字串座號', '原文', [{ name: '原文', seat_number: '1' }], '（遮罩失敗）'],
  ['拒絕小數座號', '原文', [{ name: '原文', seat_number: 1.5 }], '（遮罩失敗）'],
  ['拒絕非物件項目', '原文', [null], '（遮罩失敗）'],
]

describeDatabase('小野姓名遮罩', () => {
  const database = useTestDatabase()

  it.each(cases)('%s', async (_label, text, roster, expected) => {
    expect(await mask(database().client, text, roster)).toBe(expected)
    const agent = await connectAsRole(database(), 'ppt_agent')
    try {
      expect(await mask(agent, text, roster)).toBe(expected)
    } finally {
      await agent.end()
    }
  })

  it('小野無 ppt 的 USAGE，遮罩以呼叫者身分執行', async () => {
    const agent = await connectAsRole(database(), 'ppt_agent')
    try {
      const { rows } = await agent.query(`
        SELECT has_schema_privilege('ppt', 'USAGE') AS usage, prosecdef
        FROM pg_proc WHERE oid = 'ppt_agent.mask_student_names(text, jsonb)'::regprocedure
      `)
      expect(rows).toEqual([{ usage: false, prosecdef: false }])
      expect(await mask(agent, '王小明', [{ name: '王小明', seat_number: 6 }])).toBe('6號')
    } finally {
      await agent.end()
    }
  })
})
