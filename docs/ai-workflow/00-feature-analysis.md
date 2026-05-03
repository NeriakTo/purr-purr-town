# purr-purr-town 功能修訂技術分析

> 分析日期：2026-05-03
> 分析者：CyanMeow（青喵）
> 狀態：待三喵會議審查

---

## 需求一：期中/期末點數結算區間

### 現狀分析

**交易資料結構**（`helpers.js:416-432`）：
```javascript
{
  id: "tx_{timestamp}_{random}",
  date: "2026-05-03T08:00:00.000Z",  // ISO 8601 完整時戳
  amount: 50,
  reason: "每日任務完成 (Daily Quest)",
  balance: 1350,  // 該筆後餘額
  voided: false,   // 可選
  type: "correction"  // 可選
}
```

**現有日期基礎設施**：
- `getTodayStr()` → `yyyy-MM-dd` 格式
- `parseDate()` → Date 物件
- `formatDate()` → 字串
- `getDailyQuestNetCount()` 已有按日期過濾交易的模板（`helpers.js:439-462`）

**目前不存在的部分**：
- `DEFAULT_SETTINGS` 無任何學期日期欄位
- SettingsModal 6 個 tab 中無時間設定
- `calcTotalEarnedFromTransactions()` 無日期範圍參數
- 財富排行榜（`WealthLeaderboardModal`）僅顯示累計 totalEarned

### 技術方案

**核心改動**：

1. **新增設定欄位**（`constants.js` → `DEFAULT_SETTINGS`）：
```javascript
semesterPeriods: {
  midterm: {
    start: null,  // yyyy-MM-dd
    end: null,    // yyyy-MM-dd
  },
  final: {
    start: null,  // yyyy-MM-dd
    end: null,    // yyyy-MM-dd
  },
}
```

2. **新增區間統計函數**（`helpers.js`）：
```javascript
// 按區間過濾交易，計算淨加減分（排除 voided、store 購買）
function calcPeriodEarned(transactions, startDate, endDate)
```

3. **SettingsModal 擴充**：在「一般設定」tab 新增學期區間設定 UI（兩組日期選擇器）

4. **PassportModal 存摺擴充**：交易紀錄上方新增「期中 / 期末 / 全部」切換 tab，顯示區間小計

5. **WealthLeaderboardModal 擴充**：排行依據可切換「累計 / 期中區間 / 期末區間」

**影響範圍**：
| 檔案 | 改動程度 |
|------|---------|
| `constants.js` | 小（新增 DEFAULT_SETTINGS 欄位）|
| `helpers.js` | 小（新增 1 個過濾函數）|
| `SettingsModal.jsx` | 中（一般設定 tab 加日期選擇器）|
| `PassportModal.jsx` | 中（存摺 tab 加區間切換 + 小計）|
| `WealthLeaderboardModal.jsx` | 小（排行依據切換）|
| `DashboardView.jsx` | 無（settings 自動持久化）|

**風險評估**：
- 低風險：不改動交易核心邏輯，純粹在 UI 層過濾
- 向後相容：`semesterPeriods` 預設 null，未設定時行為與現在一致
- 資料遷移：無需遷移，交易已有完整時戳

---

## 需求二：值日生薪資發放

### 現狀分析

**薪資發放流程**（`JobSettingsTab.jsx:99-119`）：
```javascript
// payrollPreview() 邏輯：
1. 遍歷 settings.jobs（所有職務）
2. 以 selectedPayrollCycles 過濾週期（weekly/monthly/semester/once）
3. 對每個職務的 assignedIds 全部產生 payrollEntry
4. 一次性呼叫 onProcessPayroll(entries)
```

**關鍵限制**：`payrollPreview()` 只能按「週期」過濾，不能按「特定職務」過濾。

**值日生現狀**：
- 只存在於 emoji 庫中（`💂: '值日'`），無獨立系統
- 老師目前的做法：將全班都設為值日生→每人平均輪值 3-4 次
- 無法單獨對值日生發放薪資

**BulletinBoard 現狀**（`BulletinBoard.jsx`）：
- 純布告欄，顯示公告卡片
- Props：`{ announcements, onOpenAnnouncements }`
- 布局：flex-col，頂部標題+齒輪按鈕，下方 cork 風格捲動區域
- 有空間可擴充

### 方案 A：單選職務發放薪資

**改動**：修改 `JobSettingsTab` 的薪資發放 UI，從「按週期全選」改為「按職務勾選」。

```
改動前：選擇週期 [每週 ✓] [每月] [每學期] → 發放全部符合的職務
改動後：
  ┌── 選擇要發放的職務 ──────────────┐
  │ ☑ 👑 班長（300 點 × 2 人）       │
  │ ☑ 🧹 衛生長（200 點 × 1 人）     │
  │ ☐ 💂 值日生（50 點 × 2 人）      │
  │ ☐ 📋 其他...                     │
  └──────────────────────────────────┘
  [預覽] [發放]
```

**影響範圍**：
| 檔案 | 改動程度 |
|------|---------|
| `JobSettingsTab.jsx` | 中（payrollPreview 改為 per-job 勾選 + UI 改動）|
| 其他 | 無 |

**優勢**：改動最小，只動 JobSettingsTab 一個檔案
**劣勢**：值日生仍需在 jobAssignments 中每天手動切換指派學生

### 方案 B：布告欄值日生專區

**改動**：在 BulletinBoard 新增「今日值日生」區塊，可選座號 + 一鍵發薪。

```
┌── 村莊布告欄 ────────── ⚙️ ──┐
│ 📌 今日值日生                  │
│  [12] 王小明  [25] 李小華      │
│         [ 💰 發放值日薪資 ]     │
│ ─────────────────────────────│
│ 📌 公告                       │
│  ┌─────────────────┐         │
│  │ 明天帶美勞材料     │         │
│  └─────────────────┘         │
└──────────────────────────────┘
```

**影響範圍**：
| 檔案 | 改動程度 |
|------|---------|
| `constants.js` | 小（DEFAULT_SETTINGS 加 `dutyStudents: []`）|
| `BulletinBoard.jsx` | 大（新增值日生區塊 + 選擇器 + 發薪按鈕）|
| `DashboardView.jsx` | 中（新增 dutyStudents state + handleDutyPayroll）|
| `JobSettingsTab.jsx` | 小（值日生薪資設定，或直接用現有 job）|

**優勢**：操作直覺（每天在布告欄選值日生→發薪），解耦值日生與一般職務
**劣勢**：改動範圍較大，新增獨立子系統

### 方案 C（建議）：A + B 混合

**核心思路**：方案 A 的「單選職務發放」解決通用問題，再加一個輕量版值日生快選。

1. **JobSettingsTab**：薪資發放改為 per-job 勾選（方案 A）
2. **BulletinBoard**：新增「今日值日生」快選區（方案 B 精簡版），選完自動更新 jobAssignments 中值日生職務的指派
3. **發薪**：統一走 JobSettingsTab 的薪資發放（已支援單選職務），或布告欄一鍵觸發值日生薪資

**優勢**：
- per-job 勾選是通用改進，未來任何職務都受益
- 值日生快選解決每日輪替痛點
- 薪資發放邏輯不重複

---

## 工作量估算

| 項目 | 預估時間 | 複雜度 |
|------|---------|--------|
| 需求一：學期區間設定 | 2-3hr | 中 |
| 需求二-A：單選職務發放 | 1-2hr | 低 |
| 需求二-B：布告欄值日生 | 2-3hr | 中 |
| 需求二-C：A+B 混合 | 3-4hr | 中 |
| 測試 + 收尾 | 1hr | — |
| **合計（需求一 + 需求二-C）** | **6-8hr** | **中** |

---

## 待三喵會議確認事項

1. 需求一：區間設定放「一般設定 tab」還是獨立 tab？
2. 需求一：期中/期末切換要加在 PassportModal 存摺、WealthLeaderboard、還是兩者都加？
3. 需求二：選方案 A（最小改動）、B（獨立系統）、還是 C（混合）？
4. 需求二：值日生每日 2 人，是否需要排班表（自動輪替），還是每天手動選？
5. 優先順序：先做哪個需求？
