# 評語助手整合至呼嚕嚕小鎮——開發規劃書 v1.0

> 日期：2026-06-14
> 狀態：待三喵審查

## 一、背景與動機

「喵嗚評語助手」（Meow-Comment-Helper）是一個獨立的 Vue 3 單頁應用，讓國小老師透過 Google Gemini API 自動產生學期評語和八字箴言。目前它與「呼嚕嚕小鎮」（Purr-Purr-Town）是完全分離的兩個專案。

老師在使用時需要在兩個網站之間切換，且學生名單無法共用。Kevin 提出將評語功能整合進呼嚕嚕小鎮，讓老師在同一個系統裡完成班級經營和學期評語。

## 二、需求規格

### 2.1 功能需求

| 編號 | 需求 | 說明 |
|------|------|------|
| F1 | 老師密碼閘門 | 評語功能需輸入老師密碼才能開啟，防止學生誤觸 |
| F2 | 讀取現有村民資料 | 直接使用呼嚕嚕的學生清單，不需重新輸入 |
| F3 | 觀察紀錄輸入 | 每位學生可輸入文字觀察紀錄，支援多行、標籤快速插入 |
| F4 | AI 評語生成 | 透過 Gemini API 產生暖心評語（70-100 字）和八字箴言 |
| F5 | 上下學期評語保存 | 每位學生保存至少上學期、下學期兩份評語紀錄 |
| F6 | 評語鎖定 | 已確認的評語可鎖定，防止誤觸重新生成覆蓋 |
| F7 | 批次匯出 | 全班評語 Excel 匯出（座號、姓名、評語、箴言） |
| F8 | API Key 管理 | 沿用呼嚕嚕的設定面板，老師輸入 Gemini API Key |

### 2.2 非功能需求

| 編號 | 需求 | 說明 |
|------|------|------|
| NF1 | 資料持久化 | 評語資料存入學生物件，隨 IndexedDB + localStorage 雙寫自動保存 |
| NF2 | 雲端同步相容 | 評語資料隨 v4.0 Sync API 同步（若啟用） |
| NF3 | 低耦合增量整合 | 評語模組為獨立元件，需回歸測試覆蓋既有流程（Header、Settings、Passport） |
| NF4 | 行動裝置適配 | 手機和平板上可正常操作 |

## 三、架構設計

### 3.1 整合方式

採用 **React 元件內嵌**（非 iframe），直接融入呼嚕嚕的元件體系：

```
DashboardView.jsx（狀態中樞）
  ├── 現有元件（TaskBoard, SquadGrid, PassportModal...）
  └── 新增：CommentModal.jsx（評語功能入口）
        ├── CommentPanel.jsx（單一學生評語編輯面板）
        ├── CommentBatchView.jsx（全班評語總覽與批次操作）
        └── utils/commentService.js（Gemini API 呼叫邏輯）
```

### 3.2 進入點

評語功能的進入點有兩個：

1. **Header 選單**：新增「📝 評語助手」按鈕 → 開啟 `CommentModal`（全班總覽模式）
2. **PassportModal 分頁**：在學生護照裡新增「評語」分頁 → 開啟該學生的 `CommentPanel`

### 3.3 老師密碼閘門

```
localStorage "ppt_comment_password": string | null

- null / 空 → 功能未設定密碼，自由開啟
- 非空字串 → 點擊評語功能時彈出密碼輸入框
- 密碼存獨立 localStorage key，不進入 settings / 班級快照 / Sync
- 驗證通過後本次 session 記住（useState），不需重複輸入
- 密碼設定和修改在 SettingsModal 的新分頁中操作
```

### 3.4 學生資料結構擴充

在現有 student 物件上增加 `comments` 欄位：

```javascript
student.comments = {
  // 以學期為 key，支援多學期歷史
  "114-1": {  // 114學年第1學期
    rawComment: "上課認真聽講，作業準時繳交...",
    polishedComment: "小明是個認真負責的好孩子...",
    motto: "品學兼優，認真負責",
    analysis: "(A)全優",
    locked: false,
    status: "done",         // "idle" | "generating" | "done" | "error"
    errorMessage: "",
    generatedAt: "2026-06-14T10:00:00Z",
    updatedAt: "2026-06-14T10:05:00Z",
    modelUsed: "gemini-2.5-flash"
  },
  "114-2": { ... }
}
```

設計考量：
- 以學期 key 區分上下學期，自然支援歷史查閱
- 預設跟隨當前學期設定，CommentPanel 可切換查看歷史學期
- `locked` 欄位防止已確認的評語被意外覆蓋
- `status` + `errorMessage` 追蹤生成狀態，支援批次續跑
- 欄位名稱統一 camelCase（與呼嚕嚕既有慣例一致）

### 3.5 當前學期設定與敏感資料隔離

`settings` 中只新增非敏感欄位：

```javascript
settings.currentSemester = "114-2"  // 預設：根據當前月份自動推算
```

敏感資料使用獨立 localStorage key，不進入班級快照（避免隨 Sync API 上傳）：

```javascript
localStorage "ppt_gemini_api_key"       // Gemini API Key
localStorage "ppt_gemini_key_tier"      // "free" | "paid"
localStorage "ppt_comment_password"     // 評語功能密碼
```

> 三喵審查修正（貓爪 CRITICAL）：`saveClassCache()` 會把整包 settings 同步上傳，
> API Key 和密碼絕不能放在 settings 裡。

學期推算邏輯：
- 8-12 月 → 學年 = 西元年 - 1911，學期 = 1
- 1 月 → 學年 = 西元年 - 1911 - 1，學期 = 1
- 2-7 月 → 學年 = 西元年 - 1911 - 1，學期 = 2

> 三喵審查修正（貓爪 MEDIUM）：原公式在 2-7 月多算一年。

### 3.6 Gemini API 呼叫

從評語助手直接移植，封裝為 `commentService.js`：

```javascript
// commentService.js
const FREE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']
const PAID_MODELS = ['gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']

export async function generateComment({ name, rawComment, keyTier, apiKey }) {
  // 每個模型獨立 30 秒超時
  // 回傳 { analysis, comment, motto, modelUsed }
  // 錯誤處理：429 讀取 Retry-After + exponential backoff / 404 模型不存在 / 超時
  // 批次模式：單一佇列鎖，失敗學生記錄 errorMessage，支援續跑
}
```

### 3.7 安全考量

| 項目 | 處理方式 |
|------|---------|
| API Key 存儲 | 獨立 localStorage key `ppt_gemini_api_key`，避免隨 Sync 外洩（非加密存儲，為瀏覽器明文） |
| 密碼存儲 | 獨立 localStorage key `ppt_comment_password`，裝置本機限定，不跨裝置同步 |
| API Key 顯示 | 輸入框 type="password"，遮蔽顯示 |
| 密碼定位 | 防誤觸閘門，非授權系統；UI 標註「此密碼僅防誤觸，不防 DevTools」 |
| 密碼不同步 | 密碼為裝置本機設定，換電腦需重新設定；UI 需標示此限制 |

> 三喵審查修正（貓爪 CRITICAL + 黑喵補強）：
> - API Key 和密碼從 settings 隔離至獨立 localStorage key
> - 安全描述定位為「避免同步外洩」而非「安全存儲」
> - 密碼閘門定位為防誤觸，非授權系統

## 四、UI/UX 設計

### 4.1 CommentModal（全班評語總覽）

```
┌─────────────────────────────────────────────────┐
│  📝 評語助手          114學年 第2學期    [匯出]  │
│─────────────────────────────────────────────────│
│  座號  姓名    觀察紀錄        評語     箴言  🔒 │
│   01   王小明  上課認真...    已完成    已完成  🔒│
│   02   李小華  (點擊輸入)     ⏳待生成         │
│   03   張小美  活潑但話多...  已完成    已完成   │
│   ...                                          │
│                                                │
│  [全班一鍵生成]                    已完成 15/30  │
└─────────────────────────────────────────────────┘
```

- 點擊任一學生行 → 展開 CommentPanel 進行編輯
- 「全班一鍵生成」按鈕依序為未完成的學生呼叫 API（免費版間隔 5 秒、付費版間隔 2 秒，避免 429）
- 提供「停止生成」按鈕，可隨時中斷佇列
- 匯出按鈕產出 Excel（沿用呼嚕嚕的 ExcelJS）

### 4.2 CommentPanel（單一學生編輯）

```
┌─────────────────────────────────────┐
│  🐱 王小明 (01)                     │
│                                     │
│  觀察紀錄：                         │
│  ┌─────────────────────────────┐   │
│  │ 上課認真聽講，主動舉手發言    │   │
│  │ 作業準時繳交，字跡工整       │   │
│  └─────────────────────────────┘   │
│  [熱心助人] [負責盡職] [字跡工整]   │
│                                     │
│  [🐾 幫我寫]                       │
│                                     │
│  評語：                             │
│  ┌─────────────────────────────┐   │
│  │ 王小明是個認真負責的好孩子... │   │
│  └─────────────────────────────┘   │
│  箴言：品學兼優，認真負責    [🔒]   │
│                                     │
│  學期切換：[114-1] [114-2]          │
└─────────────────────────────────────┘
```

- 標籤快速插入沿用評語助手的設計（領域分類標籤）
- 評語和箴言可手動編輯
- 鎖定按鈕防止覆蓋
- 底部學期切換可查看歷史評語

## 五、開發分期

### Phase 1：基礎設施（Day 1）

| 工作項 | 檔案 | 說明 |
|--------|------|------|
| 1-1 | `utils/commentService.js` | Gemini API 封裝（模型清單、超時、錯誤處理） |
| 1-2 | `utils/constants.js` | 新增 DEFAULT_COMMENT_TAGS、DEFAULT_SEMESTER |
| 1-3 | `utils/helpers.js` | 新增 `getCurrentSemester()`、`initializeComments()` |
| 1-4 | `utils/exportUtils.js` | 新增 `exportCommentsToExcel()` |

### Phase 2：核心 UI（Day 1-2）

| 工作項 | 檔案 | 說明 |
|--------|------|------|
| 2-1 | `components/modals/CommentModal.jsx` | 全班評語總覽 + 密碼閘門 |
| 2-2 | `components/modals/CommentPanel.jsx` | 單一學生評語編輯面板 |
| 2-3 | `views/DashboardView.jsx` | 新增 showComment state + modal 掛載 |
| 2-4 | `components/common/Header.jsx` | 選單新增「📝 評語助手」入口 |

### Phase 3：整合與增強（Day 2-3）

| 工作項 | 檔案 | 說明 |
|--------|------|------|
| 3-1 | `components/modals/PassportModal.jsx` | 新增「評語」分頁 |
| 3-2 | `components/modals/SettingsModal.jsx` | 新增評語設定分頁（密碼、API Key、學期） |
| 3-3 | `components/modals/CommentModal.jsx` | 全班一鍵生成（帶節流 + 中斷按鈕 + 進度條） |
| 3-4 | 匯出整合 | 評語 Excel 匯出 |

### Phase 4：測試與收尾（Day 3）

| 工作項 | 說明 |
|--------|------|
| 4-1 | 端對端測試：API 呼叫 → 評語生成 → 保存 → 重新載入 |
| 4-2 | 行動裝置適配測試 |
| 4-3 | 既有功能回歸測試（任務、銀行、座位表不受影響） |
| 4-4 | build 通過 + deploy |

## 六、風險與緩解

| 風險 | 嚴重性 | 緩解方式 |
|------|--------|---------|
| Gemini API 模型名稱再次失效 | 中 | commentService.js 集中管理模型清單，改一處即可 |
| 學生資料結構擴充導致既有資料損壞 | 高 | `comments` 為可選欄位，`initializeComments()` 做向後相容遷移 |
| API Key 洩漏 | 高 | Key 僅存 localStorage，不進 Sync API；UI 遮蔽顯示 |
| 全班一鍵生成觸發 429 限速 | 中 | 免費版間隔 5 秒（< 13 RPM）、付費版 2 秒；提供中斷按鈕；遇 429 自動暫停 60 秒後重試 |
| PassportModal 已超 800 行，再加分頁更大 | 中 | CommentPanel 獨立元件，PassportModal 只加一個分頁切換入口 |

## 七、不做的事（Scope 排除）

- 不做自動從任務紀錄萃取觀察紀錄（MVP 手動輸入，未來迭代考慮）
- 不做行為量表評分系統（評語助手原有的六面向量表，整合後簡化為標籤 + 文字）
- 不做評語 AI 微調或 few-shot 範例管理
- 不做 GAS 雲端備份評語的獨立匯出（隨班級資料一起備份即可）
- 不遷移評語助手的 Vue 程式碼（全部以 React 重寫）

## 八、驗收標準

1. 老師可在設定面板輸入 Gemini API Key 和設定密碼
2. 點擊「📝 評語助手」需先通過密碼驗證
3. 全班學生列表自動讀取，不需手動輸入
4. 輸入觀察紀錄 + 點「幫我寫」→ 30 秒內返回評語和箴言
5. 評語保存後重新載入頁面仍在
6. 上下學期評語可切換查看
7. 全班評語可匯出 Excel
8. 手機上可正常操作
9. 既有功能（任務、銀行、座位表、商店）不受影響

## 相關文件

- 呼嚕嚕小鎮 repo：`~/github/purr-purr-town/`
- 評語助手 repo：`~/github/Meow-Comment-Helper/`
- 評語助手 Gemini API 修正：`8b3c3c1` + `53c2115` + `8064410`
