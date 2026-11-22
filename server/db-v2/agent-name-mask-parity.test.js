import { expect, it } from 'vitest'
import { maskObservation } from '../v2/comments/mask.js'
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
  ]],
  ['姓名內各種空白可忽略，保留其餘空白', 'Page 12  王 小明、王　小明、王\t小明、王\u00a0小明、王\n小明、王\u2028小明', [
    { name: '王\u0085 小\u2007明', seat_number: 3 },
  ]],
  ['同一位置以較長的寫法優先', '歐陽小明', [
    { name: '陽小', seat_number: 8 }, { name: '歐陽小明', seat_number: 5 },
  ]],
  ['兩位撞名依座號排列', '小明', [
    { name: '王小明', seat_number: 12 }, { name: '陳小明', seat_number: 3 },
  ]],
  ['三位撞名依座號排列', '小明', [
    { name: '王小明', seat_number: 12 }, { name: '林小明', seat_number: 9 }, { name: '陳小明', seat_number: 3 },
  ]],
  ['四位撞名統稱某位同學', '小明', [
    { name: '王小明', seat_number: 1 }, { name: '陳小明', seat_number: 2 },
    { name: '林小明', seat_number: 3 }, { name: '歐陽小明', seat_number: 4 },
  ]],
  ['整班預設名的村民末兩字撞名', '村民', [
    { name: '1號村民', seat_number: 1 }, { name: '2號村民', seat_number: 2 },
    { name: '3號村民', seat_number: 3 }, { name: '4號村民', seat_number: 4 },
  ]],
  ['預設村民末兩字撞名並可與假姓名共存', '村民，王小明', [
    { name: '1號村民', seat_number: 1 }, { name: '2號村民', seat_number: 2 },
    { name: '3號村民', seat_number: 3 }, { name: '4號村民', seat_number: 4 },
    { name: '王小明', seat_number: 5 },
  ]],
  ['單一空座號和撞名空座號', '陳大文，小明', [
    { name: '陳大文', seat_number: null }, { name: '王小明', seat_number: null },
    { name: '陳小明', seat_number: 2 },
  ]],
  ['替換結果不再掃描', '甲乙丙', [
    { name: '甲乙丙', seat_number: 12 }, { name: '12', seat_number: 9 },
  ]],
  ['正規式特殊字元按字面比對', 'A.B AxB | . *( [ \\', [
    { name: 'A.B', seat_number: 2 }, { name: '*(', seat_number: 3 },
    { name: '[', seat_number: 4 }, { name: '\\', seat_number: 5 },
  ]],
  ['英文忽略大小寫，略過空姓名並遮一字姓名', 'aMy  丁', [
    { name: 'Amy', seat_number: 7 }, { name: '', seat_number: 1 },
    { name: '\t　', seat_number: 2 }, { name: '丁', seat_number: 5 },
  ]],
  ['同一中文姓名出現四次並夾雜不同空白', '王小明 王\t小明\n王小　明 王\u00a0小\u2009明', [
    { name: '王小明', seat_number: 3 },
  ]],
  ['同一英文名出現三次並夾雜不同空白', 'bEN、B\u202feN、b\u2003e\tN', [
    { name: 'Ben', seat_number: 8 },
  ]],
  ['表情符號前後各緊鄰一個姓名', '王小明😀陳大文', [
    { name: '王小明', seat_number: 3 }, { name: '陳大文', seat_number: 5 },
  ]],
  ['姓名緊鄰多個補充平面字元', '𠮷林小華🦊歐陽大文𠮷', [
    { name: '林小華', seat_number: 6 }, { name: '歐陽大文', seat_number: 9 },
  ]],
  ['兩字全名撞上三字姓名的去姓寫法', '小明，王小明', [
    { name: '小明', seat_number: 8 }, { name: '王小明', seat_number: 3 },
  ]],
  ['兩字全名撞上四字姓名的末兩字', '華強與歐陽華強', [
    { name: '華強', seat_number: 9 }, { name: '歐陽華強', seat_number: 2 },
  ]],
  ['一個空座號與兩個已定座號撞名', '大文', [
    { name: '王大文', seat_number: null }, { name: '林大文', seat_number: 12 },
    { name: '陳大文', seat_number: 3 },
  ]],
  ['五位撞名含空座號', '小華、林小華', [
    { name: '王小華', seat_number: null }, { name: '林小華', seat_number: 9 },
    { name: '陳小華', seat_number: 3 }, { name: '許小華', seat_number: 7 },
    { name: '歐陽小華', seat_number: 5 },
  ]],
  ['含小數點的假名與英文名緊鄰', 'A.BBen、AxBBen', [
    { name: 'A.B', seat_number: 3 }, { name: 'Ben', seat_number: 5 },
  ]],
  ['含加號和括號的假名緊鄰前後兩個姓名', '王大+(小)陳大文', [
    { name: '王大', seat_number: 1 }, { name: '+(小)', seat_number: 2 },
    { name: '陳大文', seat_number: 3 },
  ]],
  ['由左往右、同一位置取最長的拼法', '虛甲乙、另虛甲乙', [
    { name: '虛甲乙', seat_number: 3 }, { name: '甲乙', seat_number: 5 },
    { name: '另虛', seat_number: 6 },
  ]],
  ['相連的姓名共用明字', '小明華強', [
    { name: '林小明', seat_number: 1 }, { name: '明華強', seat_number: 2 },
  ]],
  ['無分隔的等長姓名相接並共用大字', '王大大文，王大文', [
    { name: '王大', seat_number: 1 }, { name: '大文', seat_number: 2 },
  ]],
  ['較早的短英文名與後面的長英文名重疊', 'AmyBen', [
    { name: 'Amy', seat_number: 3 }, { name: 'MyBen', seat_number: 5 },
  ]],
  ['較早的短中文名與跨全形空白的長姓名重疊', '王小　明華強', [
    { name: '王小', seat_number: 3 }, { name: '小明華強', seat_number: 5 },
  ]],
  ['ASCII 與重音大寫開頭的英文名混用大小寫', 'aMy、éMiLE、ÉMiLE', [
    { name: 'Amy', seat_number: 3 }, { name: 'Émile', seat_number: 5 },
  ]],
  ['名冊用大寫分音字母、文字用小寫分音字母', 'Zoë、ZOË', [
    { name: 'ZOË', seat_number: 8 },
  ]],
  ['全形英文名混用大小寫並保留半形英文', 'ＡＭＹ、Ａｍｙ、Amy', [
    { name: 'Ａｍｙ', seat_number: 6 },
  ]],
]

describeDatabase('資料庫與評語後端姓名遮罩一致性', () => {
  const database = useTestDatabase()

  it.each(cases)('%s', async (_label, text, roster) => {
    const agent = await connectAsRole(database(), 'ppt_agent')
    try {
      expect(await mask(agent, text, roster)).toBe(maskObservation(text, roster))
    } finally {
      await agent.end()
    }
  })
})
