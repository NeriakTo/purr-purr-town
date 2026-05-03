# 三喵會議審查結果

> 日期：2026-05-03
> R1：DarkMeow（黑喵）— 12 findings
> R2：MeowClaw（貓爪）— 10 findings
> 去重合併：18 → 14 條（3 CRITICAL / 5 HIGH / 4 MEDIUM / 2 LOW）

---

## CRITICAL（必須修正才可開工）

### C1. calcPeriodEarned 必須與 calcTotalEarnedFromTransactions 共用排除邏輯
**來源**：R1-F1 + R2-F3（兩人獨立發現）

**問題**：`calcTotalEarnedFromTransactions` 的排除邏輯比「voided + store」更複雜——它還建立 `txMap` 交叉參照，排除 `type === 'correction'` 且 `correctedTxId` 指向商店消費的修正紀錄。若 `calcPeriodEarned` 重新實作簡化版本，會導致「期中小計 + 期末小計 ≠ 全學期累計」，老師對帳時數字不一致。

**決議**：重構 `calcTotalEarnedFromTransactions` 為接受 optional `{ startDate, endDate }` 參數的統一函數：

```javascript
export function calcEarnedFromTransactions(transactions, { startDate, endDate } = {}) {
  if (!transactions?.length) return 0
  // Step 1: 日期範圍過濾（轉本地日期比對）
  let filtered = transactions
  if (startDate || endDate) {
    filtered = filtered.filter(tx => {
      const txLocalDate = formatDate(new Date(tx.date)) // yyyy-MM-dd local
      if (startDate && txLocalDate < startDate) return false
      if (endDate && txLocalDate > endDate) return false
      return true
    })
  }
  // Step 2: 完全相同的 voided/store/correction 排除邏輯
  const txMap = Object.fromEntries(filtered.map(tx => [tx.id, tx]))
  return filtered
    .filter(tx => {
      if (tx.voided) return false
      if (isStorePurchaseReason(tx.reason)) return false
      if (tx.type === 'correction' && tx.correctedTxId) {
        const original = txMap[tx.correctedTxId]
        if (original && isStorePurchaseReason(original.reason)) return false
      }
      return true
    })
    .reduce((sum, tx) => sum + (tx.amount || 0), 0)
}
```

保留原函數名作為 alias 以向後相容：
```javascript
export const calcTotalEarnedFromTransactions = (tx) => calcEarnedFromTransactions(tx)
```

---

### C2. 值日生臨時狀態不應存入 jobAssignments
**來源**：R1-F2 + R2-F1（兩人獨立發現，CRITICAL 共識）

**問題**：`jobAssignments` 是長期職務指派結構（班長、衛生長），persist 到 LocalStorage。值日生是每日輪替，若寫入 jobAssignments：
- 隔天開系統仍顯示昨天的值日生（不會自動清除）
- PassportModal 的 `studentJobs` 會永久標記該學生為值日生
- 週一忘記發薪、週二換人後，週一的值日薪資永遠無法正確追溯

**決議**：使用獨立 state，不污染 jobAssignments：

```javascript
// DEFAULT_SETTINGS 新增
dailyDuty: {
  date: null,        // yyyy-MM-dd，系統開啟時比對今天日期
  studentIds: [],    // 今日值日生座號
  paid: false,       // 是否已發薪（防重複）
}
```

**Workflow（強制閉環）**：
1. 老師在布告欄選值日生 → 寫入 `dailyDuty.studentIds`，`date = today`，`paid = false`
2. 老師點「發放值日薪資」→ 建立交易 → `paid = true`，按鈕變灰色顯示「已發放 ✓」
3. 隔天系統偵測 `dailyDuty.date !== today` → 自動重置 `{ date: today, studentIds: [], paid: false }`
4. 若昨天忘記發薪（`paid === false` 且 date 是過去），顯示提醒「昨日值日薪資尚未發放」

---

### C3. 缺少值日生職務的唯一識別機制
**來源**：R1-F3

**問題**：codebase 無任何方式標記「哪個 job 是值日生」。老師可能未建立值日生職務、建了多個含「值日」的職務、或名稱不含「值日」二字。

**決議**：`DEFAULT_SETTINGS` 新增 `dutyJobId: null`，指向值日生職務的 job ID。BulletinBoard 讀取此 ID 對應 job 的薪資金額。

**首次設定流程**：
- BulletinBoard 偵測 `dutyJobId === null` → 顯示引導卡片「請先設定值日生職務」
- 引導選項：(a) 從現有 job 下拉選擇，或 (b) 一鍵自動建立（預設 `{ title: '值日生', salary: 50, cycle: 'daily', category: 'other' }`）
- 設定完成後自動存入 `settings.dutyJobId`

---

## HIGH（開發計畫必須包含）

### H1. 時區陷阱：UTC timestamp vs local date
**來源**：R1-F4 + R2-F4（兩人獨立發現）

**問題**：`createTransaction()` 用 `new Date().toISOString()`（UTC），但學期區間日期是本地 `yyyy-MM-dd`。若以 `tx.date.split('T')[0]` 取日期，跨午夜交易會歸入錯誤日期。

**決議**：統一使用 `formatDate(new Date(tx.date))` 轉本地日期再比對（已納入 C1 的重構函數）。

### H2. settings 淺層合併無法處理巢狀 semesterPeriods
**來源**：R1-F5

**問題**：`DashboardView.jsx:68` 用 `{ ...DEFAULT_SETTINGS, ...cached.settings }` 淺層合併。新增的巢狀 `semesterPeriods` 和 `dailyDuty` 可能被 cached 版本不完整覆蓋。

**決議**：在載入 settings 時，對新增的巢狀欄位做 per-field fallback：
```javascript
settings.semesterPeriods = {
  midterm: { start: null, end: null, ...(cached?.semesterPeriods?.midterm) },
  final: { start: null, end: null, ...(cached?.semesterPeriods?.final) },
}
settings.dailyDuty = { date: null, studentIds: [], paid: false, ...(cached?.dailyDuty) }
```

### H3. 值日薪資重複發放防護
**來源**：R1-F6

**問題**：布告欄「一鍵發薪」無冪等性保護。老師不小心按兩次會發雙倍。

**決議**：利用 C2 的 `dailyDuty.paid` flag。發薪後 `paid = true`，按鈕顯示「已發放 ✓」且 disabled。若老師確實需要重複發放（補發等），長按或雙擊可解鎖重新發放（帶確認對話框）。

### H4. JOB_CYCLES 缺少 daily 週期
**來源**：R2-F2

**問題**：現有 cycle 只有 weekly/monthly/semester/once，值日生若建為一般 job 無合適 cycle。

**決議**：`JOB_CYCLES` 新增 `daily: '每日'`。值日生 job 預設 `cycle: 'daily'`。`payrollPreview()` 的 cycle 過濾自然支援。

### H5. per-job 勾選應保留 by-cycle 群組結構
**來源**：R2-F5

**問題**：若把 by-cycle 改為 pure per-job，有 8-10 個職務時老師每次都要逐一勾選，操作效率下降。

**決議**：**兩層結構**——第一層 by-cycle 群組（收合/展開 + 全選 checkbox），第二層 per-job checkbox。老師可以「全選 weekly → 取消勾選值日生」，兼顧批次便利和細粒度控制。

---

## MEDIUM

### M1. 學期區間日期驗證
**來源**：R1-F8 + R2-F6

**決議**：SettingsModal 日期選擇器即時驗證——`end >= start`、`final.start > midterm.end`。半殘狀態（只填一端）視為未設定，fallback 全部顯示。

### M2. PassportModal 抽出 PeriodFilter 元件
**來源**：R2-F7

**決議**：區間切換 + 小計抽為 `PeriodFilter.jsx`（~60 行），PassportModal 只傳 transactions + semesterPeriods。符合 CLAUDE.md 800 行上限原則。

### M3. BulletinBoard 新增 props 完整列表
**來源**：R1-F7 + R2-F8

**決議**：BulletinBoard 新 props：
```javascript
{
  announcements, onOpenAnnouncements,  // 現有
  activeStudents,                       // 值日生快選用（已排除 inactive）
  dailyDuty,                           // { date, studentIds, paid }
  dutyJob,                             // job 物件（含 salary、icon）
  onDutyChange,                        // (studentIds) => void
  onDutyPayroll,                       // () => void
}
```

### M4. 其他 UX 細節
- 值日薪資 reason 含日期：`"值日生 薪資 (05/03)"` (R1-F9)
- 0 人指派職務在 per-job 清單中 disabled + 提示 (R1-F10)

---

## LOW

### L1. 資料結構預留 duty history 擴充
**來源**：R2-F9

第一版不實作排班表，但 `dailyDuty` 的 date 欄位已可支援未來擴充為 `dutyHistory[]`。

### L2. 學期區間設定放一般設定 tab 子區塊
**來源**：R2-F10

不值得獨立 tab，在一般設定 tab 底部加 section header「📅 學期區間」即可。

---

## 審查結論

| | R1 DarkMeow | R2 MeowClaw |
|---|---|---|
| 結論 | 有條件通過 | 有條件通過 |
| 條件 | C1/C2/C3 補齊 | C2 + H2/H4/H5 修正 |

**青喵裁定：有條件通過。** CRITICAL 3 條 + HIGH 5 條已有明確解法（見上方決議），可直接進入開發計畫，不需再跑一輪審查。
