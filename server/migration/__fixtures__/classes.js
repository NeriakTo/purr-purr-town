// 完全虛構的兩班；已核銷實例不在舊背包內。
const tx = (id, amount, reason, balance, extra = {}) => ({ id, amount, reason, balance, date: '2026-09-01T08:00:00Z', ...extra })
export const classA = {
  classId: 'fake-A', className: '假班甲', data: {
    classId: 'fake-A', className: '假班甲', teacher: '測試老師甲', updatedAt: '2026-11-15T04:00:00Z',
    students: [{ id: 's1', name: '測試甲', number: 1, group: 1, avatar: '🐱', inactive: false,
      bank: { balance: 55, totalEarned: 85, transactions: [
        tx('t1', 100, '獎勵', 100, { voided: true }),
        tx('t2', -20, '修正', 80, { type: 'correction', correctedTxId: 't1', voided: true }),
        tx('t3', 5, '再修正差額', 85, { type: 'correction', correctedTxId: 't2' }),
        tx('t4', -30, '購買 假道具', 55), tx('t5', 0, '使用道具: 假道具', 55),
      ] },
      inventory: [{ itemId: 'p1', name: '假道具', icon: '🎫', purchasedAt: '2026-09-01' }, { itemId: 'p1', name: '假道具', icon: '🎫', purchasedAt: '2026-09-01' }],
      taskExemptRules: [{ keyword: '數學', taskType: '作業' }],
      comments: { '114-2': { rawComment: '假觀察', polishedComment: '假評語', motto: '假箴言', analysis: 'A', locked: true, lockedComment: false, lockedMotto: true, status: 'done', errorMessage: '', generatedAt: null, updatedAt: null, modelUsed: 'fake' }, '115-1': { rawComment: '假紀錄二', locked: true } },
    }, { id: 's2', name: '測試乙', number: 2, group: 1, inactive: true, bank: { balance: -20, transactions: [tx('u1', -20, '缺交', -20)] }, inventory: [], comments: {}, taskExemptRules: { keywords: ['假'], taskTypes: ['訂正'] } }],
    logs: [{ date: '2026-09-01', tasks: [true, 'on_time', 'late', 'missing', 'leave', 'exempt', 'makeup', false, null, 'alien'].map((_, i) => ({ id: `q${i}`, title: `假作業${i}`, type: i === 6 ? '訂正' : '作業', createdAt: '2026-09-01', dueDate: '2026-09-02' })), status: { s1: Object.fromEntries([true, 'on_time', 'late', 'missing', 'leave', 'exempt', 'makeup', false, null, 'alien'].flatMap((s, i) => i === 8 ? [] : [[`q${i}`, s]])), ghost: { q0: 'late', gone: 'missing' } } }],
    settings: { currentSemester: null, taskTypes: ['作業', '訂正'], groupAliases: { 1: '假組' }, announcements: [{ id: 'a1', text: '假公告', color: '#FFF', rotate: 1 }], jobs: [{ id: 'j1', title: '假職務', salary: 10, cycle: 'daily', category: 'other', icon: '🐱' }], jobAssignments: { j1: ['s1', 'ghost'] }, dutyJobId: 'j1', dailyDuty: { date: '2026-09-01', studentIds: ['s1'], paid: true }, behaviorRules: [{ id: 'r1', label: '假規則', amount: -20, type: 'fine', icon: '🐱', category: '作業' }], ruleCategories: [{ id: 'c1', name: '作業', icon: '🐱' }], automation: { dailyQuestBonus: 50, latePenalty: -10, missingPenalty: -20 }, shop: { name: '假商店', icon: '🐱', products: [{ id: 'p1', name: '假道具', price: 10, priceUnit: 'point', stock: 0, initialStock: 3, icon: '🎫' }] }, currency: { base: { name: '假分', icon: '💎' }, tier1: { name: '假魚', rate: 100, icon: '🐟' }, tier2: { name: '假餅', rate: 1000, icon: '🍪' } }, seatingChart: { rows: 2, cols: 2, grid: { '0_0': 's1', '0_1': 'ghost' }, objects: { '1_0': 'board' }, customObjects: [{ id: 'obj1', name: '假物', icon: '🐱', color: '#FFF' }], perspective: 'teacher' }, semesterPeriods: { midterm: { start: '2026-09-01', end: '2026-10-31' }, final: { start: null, end: null } } },
  },
}
export const classB = {
  classId: 'fake-B', className: '假班乙', data: {
    classId: 'fake-B', className: '假班乙', teacher: '測試老師乙', updatedAt: '2026-01-10T00:00:00Z',
    students: [{ uuid: 'old-s', name: '測試丙', bank: { balance: 7, totalEarned: 12, transactions: [tx('b1', 10, '獎勵', 10), tx('b2', -3, '購買 假卡', 7), tx('b3', 0, '使用道具: 假卡', 7)] }, inventory: [], comments: { '113-1': { lockedComment: true, lockedMotto: false, polishedComment: '假歷史' } }, extraStudent: '未知保留' }],
    logs: [{ date: '', tasks: [{ title: '無編號假任務', type: '訂正' }], status: {} }],
    settings: { currentSemester: '', storeItems: [{ id: 'old-p', name: '舊假商品', stock: null }], currencyRates: { fish: 100, cookie: 1000 }, extraSetting: { nested: 42 } },
  },
}
