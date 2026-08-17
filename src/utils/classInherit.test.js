import { describe, it, expect } from 'vitest'
import { deriveInheritedSettings, summarizeInheritance } from './classInherit'
import { DEFAULT_SETTINGS } from './constants'

// 一個「上一屆」班級的 settings，含各種綁學生／學期的髒資料。
function makeSourceSettings() {
  return {
    jobs: [
      { id: 'job_a', title: '班長', salary: 300, cycle: 'weekly', category: 'cadre' },
      { id: 'job_b', title: '衛生股長', salary: 200, cycle: 'weekly', category: 'cleaning' },
    ],
    behaviorRules: [{ id: 'r1', label: '作業缺交', amount: -200, type: 'fine', category: '作業' }],
    ruleCategories: [{ id: 'cat_hw', name: '作業', icon: '📚' }],
    currency: { base: { name: '點', icon: '⭐' }, tier1: { name: '魚', rate: 50 }, tier2: { name: '餅', rate: 500 } },
    automation: { dailyQuestBonus: 80, latePenalty: -5, missingPenalty: -30 },
    taskTypes: ['作業', '考試', '通知單'],
    groupAliases: { A: '獅子隊', B: '老虎隊' },
    shop: {
      name: '舊班商店',
      icon: '🐯',
      products: [
        { id: 'p1', name: '減功課卡', price: 1, priceUnit: 'cookie', stock: 0, initialStock: 10 },
        { id: 'p2', name: '午休免睡卡', price: 2, priceUnit: 'cookie', stock: 3 }, // 無 initialStock
      ],
    },
    // 以下全部應被重設
    jobAssignments: { job_a: ['s_oldclass_1', 's_oldclass_5'] },
    dailyDuty: { date: '2026-06-14', studentIds: ['s_oldclass_3'], paid: true },
    announcements: [{ id: 'a1', text: '上學期的公告' }],
    semesterPeriods: { midterm: { start: '2025-09-01', end: '2025-11-01' }, final: { start: '2025-11-02', end: '2026-01-20' } },
    currentSemester: '114-2',
    dutyJobId: 'job_b',
    seatingChart: {
      rows: 5, cols: 6, perspective: 'student',
      grid: { '0_0': 's_oldclass_1', '2_3': 's_oldclass_9' }, // 舊生座位
      objects: { '0_0': 'blackboard', '9_9': 'door', '1_1': 'unknown_obj' }, // 越界 + 未知
      customObjects: [{ id: 'custom_pet', label: '寵物角', icon: '🐹' }],
    },
  }
}

describe('deriveInheritedSettings 承接白名單', () => {
  it('帶走職務、獎懲、分類、貨幣、自動化、任務類型、小組別名', () => {
    const out = deriveInheritedSettings(makeSourceSettings())
    expect(out.jobs).toHaveLength(2)
    expect(out.behaviorRules[0].label).toBe('作業缺交')
    expect(out.ruleCategories[0].name).toBe('作業')
    expect(out.currency.tier1.rate).toBe(50)
    expect(out.automation.dailyQuestBonus).toBe(80)
    expect(out.taskTypes).toEqual(['作業', '考試', '通知單'])
    expect(out.groupAliases).toEqual({ A: '獅子隊', B: '老虎隊' })
  })

  it('商店名稱與商品帶走，但庫存重設為 initialStock', () => {
    const out = deriveInheritedSettings(makeSourceSettings())
    expect(out.shop.name).toBe('舊班商店')
    const p1 = out.shop.products.find(p => p.id === 'p1')
    const p2 = out.shop.products.find(p => p.id === 'p2')
    expect(p1.stock).toBe(10) // 舊班賣到 0，新班回到初始 10
    expect(p1.initialStock).toBe(10)
    expect(p2.stock).toBe(3) // 無 initialStock → 以現值當初始
    expect(p2.initialStock).toBe(3)
  })

  it('預設商品即使賣到剩量不明，也用內建初始庫存回滿', () => {
    const src = makeSourceSettings()
    // 模擬舊資料：預設商品被賣到 stock:2，且沒有 initialStock
    src.shop.products = [{ id: 'prod_homework_off', name: '減功課卡', price: 1, priceUnit: 'cookie', stock: 2 }]
    const out = deriveInheritedSettings(src)
    const p = out.shop.products[0]
    expect(p.stock).toBe(10) // 內建初始庫存
    expect(p.initialStock).toBe(10)
  })
})

describe('deriveInheritedSettings 重設綁學生／學期欄位', () => {
  it('職務指派、公告、值日生、學期一律清空', () => {
    const out = deriveInheritedSettings(makeSourceSettings())
    expect(out.jobAssignments).toEqual({})
    expect(out.announcements).toEqual([])
    expect(out.dailyDuty).toEqual(DEFAULT_SETTINGS.dailyDuty)
    expect(out.semesterPeriods).toEqual(DEFAULT_SETTINGS.semesterPeriods)
    expect(out.currentSemester).toBe(null)
  })

  it('dutyJobId 指向已承接的職務時保留', () => {
    const out = deriveInheritedSettings(makeSourceSettings()) // dutyJobId=job_b 存在
    expect(out.dutyJobId).toBe('job_b')
  })

  it('dutyJobId 指向不存在的職務時清成 null', () => {
    const src = makeSourceSettings()
    src.dutyJobId = 'job_deleted'
    const out = deriveInheritedSettings(src)
    expect(out.dutyJobId).toBe(null)
  })
})

describe('deriveInheritedSettings 座位表', () => {
  it('清空學生座位、保留尺寸與視角、過濾越界與未知物件', () => {
    const out = deriveInheritedSettings(makeSourceSettings())
    expect(out.seatingChart.grid).toEqual({}) // 舊生座位清空
    expect(out.seatingChart.rows).toBe(5)
    expect(out.seatingChart.cols).toBe(6)
    expect(out.seatingChart.perspective).toBe('student')
    // 合法物件保留、越界(9_9)與未知(unknown_obj)丟棄
    expect(out.seatingChart.objects).toEqual({ '0_0': 'blackboard' })
    expect(out.seatingChart.customObjects).toHaveLength(1)
  })

  it('引用自訂物件的座標會被保留', () => {
    const src = makeSourceSettings()
    src.seatingChart.objects = { '1_1': 'custom_pet' }
    const out = deriveInheritedSettings(src)
    expect(out.seatingChart.objects).toEqual({ '1_1': 'custom_pet' })
  })
})

describe('deriveInheritedSettings 邊界', () => {
  it('來源為空回一份預設 settings', () => {
    expect(deriveInheritedSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(deriveInheritedSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('不修改來源物件（不可變）', () => {
    const src = makeSourceSettings()
    const before = JSON.stringify(src)
    deriveInheritedSettings(src)
    expect(JSON.stringify(src)).toBe(before)
  })

  it('回傳物件與來源不共用巢狀參照', () => {
    const src = makeSourceSettings()
    const out = deriveInheritedSettings(src)
    out.jobs[0].salary = 999
    expect(src.jobs[0].salary).toBe(300)
  })
})

describe('summarizeInheritance 預覽摘要', () => {
  it('條列將帶走的項目數量', () => {
    const items = summarizeInheritance(makeSourceSettings())
    expect(items.some(t => t.includes('職務 2 項'))).toBe(true)
    expect(items.some(t => t.includes('庫存重設'))).toBe(true)
  })
  it('空來源回空陣列', () => {
    expect(summarizeInheritance(null)).toEqual([])
  })
})
