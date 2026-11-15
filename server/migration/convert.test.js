import { describe, it, expect } from 'vitest'
import { convert } from './convert.js'
import { reconcile } from './reconcile.js'
import { classA, classB } from './__fixtures__/classes.js'

describe('1A 假資料轉換契約', () => {
  it('狀態逐值對應；缺鍵不同於 false；補交不產生回沖', () => {
    const { rows } = convert(classA)
    expect(rows.submissions.filter(r => r.legacy_student_id === 's1').map(r => [r.status, r.present])).toEqual([
      ['on_time', true], ['on_time', true], ['late', true], ['missing', true], ['leave', true], ['exempt', true], ['makeup', true], ['pending', true], ['pending', false], ['unknown', true],
    ])
    expect(rows.transactions).toHaveLength(6)
    expect(rows.tasks[6]).toMatchObject({ correction_state: 'legacy_unlinked', original_task_id: null, teacher_confirmed: null, assignees_known: false, semester: '115-1' })
  })
  for (const source of [classA, classB]) {
    it(`${source.classId} 重跑完全一致，不修改輸入，資料列 ID 無重複`, () => {
      const before = structuredClone(source)
      const a = convert(source)
      expect(convert(source)).toEqual(a)
      expect(source).toEqual(before)
      for (const list of Object.values(a.rows)) expect(new Set(list.map(r => r.id)).size).toBe(list.length)
    })
    it(`${source.classId} 逐生完整對帳通過（錯誤隔離與對帳分開）`, () => {
      expect(reconcile(source, convert(source)).differences).toEqual([])
    })
  }
  it('餘額包含 voided 原交易；累計保留舊快取與獨立重算差異', () => {
    const out = convert(classA)
    expect(out.rows.accounts[0]).toMatchObject({ balance: 55, total_earned: 85, ledger_sum: 55, earned_recomputed: 5 })
    expect(out.rows.transactions[2].corrected_transaction_id).toBe(out.rows.transactions[1].id)
    expect(out.rows.transactions[1].corrected_transaction_id).toBe(out.rows.transactions[0].id)
    expect(out.report.notices.some(e => e.code === 'TOTAL_EARNED_DRIFT')).toBe(true)
  })
  it('背包同商品每件分開、無交易猜配；核銷僅保留使用交易', () => {
    const out = convert(classA)
    expect(out.rows.inventory_items).toHaveLength(2)
    expect(out.rows.inventory_items[0].id).not.toBe(out.rows.inventory_items[1].id)
    expect(out.rows.inventory_items.every(r => r.purchase_transaction_id === null)).toBe(true)
    expect(out.rows.transactions.filter(r => r.reason?.startsWith('使用道具'))).toHaveLength(1)
  })
  it('未知欄位、狀態及孤立關聯皆列錯誤，原值保留', () => {
    const a = convert(classA)
    expect(a.errors.map(e => e.code)).toEqual(expect.arrayContaining(['UNKNOWN_STATUS', 'ORPHAN_STUDENT', 'ORPHAN_TASK']))
    const b = convert(classB)
    expect(b.errors.filter(e => e.code === 'UNKNOWN_FIELD').map(e => e.path)).toEqual(expect.arrayContaining(['/data/students/0/extraStudent', '/data/settings/extraSetting']))
    expect(b.rows.migration_sources[0].raw).toEqual(classB)
    expect(a.rows.students[1].enrollment_status).toBe('home_study')
  })
  it('學期按原 key、雙鎖含舊 locked 後備；空 currentSemester 依匯出日期固定推算', () => {
    const a = convert(classA)
    expect(a.rows.classes[0].current_semester).toBe('115-1')
    expect(convert(classB).rows.classes[0].current_semester).toBe('114-1')
    expect(a.rows.comments.map(r => [r.semester, r.locked_comment, r.locked_motto])).toEqual([['114-2', false, true], ['115-1', true, true]])
  })
  it.each(['balance', 'total_earned', 'ledger_sum', 'earned_recomputed'])('對帳能抓出 %s 被改壞', field => {
    const out = convert(classA)
    out.rows.accounts[0][field] += 1
    expect(reconcile(classA, out).differences.length).toBeGreaterThan(0)
  })
  it.each(['transactions', 'inventory_items', 'comments', 'products', 'submissions', 'settings_entries'])('對帳能抓出 %s 遺失、重複、內容損壞', table => {
    const out = convert(classA)
    out.rows[table].pop()
    expect(reconcile(classA, out).differences.length).toBeGreaterThan(0)
    const duplicate = convert(classA)
    duplicate.rows[table].push(duplicate.rows[table][0])
    expect(reconcile(classA, duplicate).differences.length).toBeGreaterThan(0)
    const corrupt = convert(classA)
    corrupt.rows[table][0].raw = { broken: true }
    expect(reconcile(classA, corrupt).differences.length).toBeGreaterThan(0)
  })
  it('更正鏈損壞會被對帳抓出', () => {
    const out = convert(classA)
    out.rows.transactions[1].corrected_transaction_id = null
    expect(reconcile(classA, out).differences.length).toBeGreaterThan(0)
  })
  it('重複舊 ID、更正孤立或循環、非法金額不會靜默吞掉', () => {
    const source = structuredClone(classA)
    source.data.students[0].bank.transactions.push({ id: 't1', amount: 'NaN', type: 'correction', correctedTxId: 'absent' })
    source.data.students[0].bank.transactions[0].correctedTxId = 't3'
    // 重複 t1 的關聯應隔離；另用不含歧義的自循環測試循環偵測。
    source.data.students[0].bank.transactions[2].correctedTxId = 't3'
    const out = convert(source)
    expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(['DUPLICATE_LEGACY_ID', 'INVALID_AMOUNT', 'ORPHAN_CORRECTION', 'CORRECTION_CYCLE']))
  })
  it('既有列舉欄位的未知值也必須報錯，保留原值', () => {
    const source = structuredClone(classA)
    source.data.settings.jobs[0].cycle = 'alien'
    source.data.settings.shop.products[0].priceUnit = 'alien'
    source.data.students[0].comments['114-2'].status = 'alien'
    const out = convert(source)
    expect(out.errors.map(e => e.code)).toEqual(expect.arrayContaining(['UNKNOWN_JOB_CYCLE', 'UNKNOWN_PRICE_UNIT', 'UNKNOWN_COMMENT_STATUS']))
    expect(out.rows.jobs[0].raw.cycle).toBe('alien')
  })
})
