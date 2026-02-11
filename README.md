# 🐱 呼嚕嚕小鎮 (Purr Purr Town) v3.7.0

> **班級經營的動物森友會 (Classroom Animal Crossing Edition)**
> 專為導師打造的 Local-First (本地優先) 遊戲化班級經營系統——結合財商教育、職務模擬與溫馨互動，讓班級管理變成一場療癒的冒險！

![Version](https://img.shields.io/badge/version-3.7.0-orange)
![Tech](https://img.shields.io/badge/React-19-blue)
![Build](https://img.shields.io/badge/Vite-7.0-purple)
![Style](https://img.shields.io/badge/Tailwind-4.0-38bdf8)
![Data](https://img.shields.io/badge/Local_First-Privacy-green)
![Backend](https://img.shields.io/badge/Google_Apps_Script-Backup-yellow)
![License](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-lightgrey)

## 📖 專案概述 (Overview)

**呼嚕嚕小鎮** 是一個基於 Web 的單頁應用程式 (SPA)，旨在將繁瑣的班級經營轉化為有趣的村民互動。不同於傳統生硬的計分系統，我們引入了「自動化」、「多重貨幣」、「職務發薪」與「道具商店」等機制。

---

## ⚡ v3.7.0 核心亮點 (NEW!)

**村莊建設！打造專屬教室空間**

v3.7.0 聚焦於「空間管理」與「紙本輸出」，讓教室座位安排、職務分配都變得視覺化且可匯出。

### 🪑 拖曳式座位表

| 功能 | 說明 |
|------|------|
| **🖱️ 拖曳入座** | 全螢幕座位表編輯器，從左側面板拖曳學生至座位格 |
| **🧩 教室物件** | 內建 11 種教室物件（電腦、講桌、門、窗戶、垃圾桶等），可拖曳放置於格位 |
| **➕ 自訂物件** | 透過圖示選擇器新增任意教室物件，支援無限擴充 |
| **👁️ 視角切換** | 老師視角 / 學生視角一鍵切換，Grid 旋轉 180° 學生名字保持正向 |
| **📊 Excel 匯出** | 一鍵下載座位表 `.xlsx` 檔案，格位位置完整對應 |
| **🖨️ 列印支援** | A4 橫式列印，自動隱藏控制項，講台區域清晰標示 |

### 👔 職務分類與快速分配

| 功能 | 說明 |
|------|------|
| **🏷️ 三大分類** | 職務支援「幹部 / 打掃 / 其他」分類標籤，一目瞭然 |
| **⚡ 快速分配** | 選定職務後連點學生即完成指派，大幅減少操作步驟 |
| **📊 職務匯出** | 依分類匯出多 Sheet 的 Excel 職務表 |

---

## 🌟 核心功能特色 (Key Features)

我們將班級經營拆解為四大支柱：**經濟循環**、**職務責任**、**空間管理** 與 **視覺回饋**。

### 1. 橘喵商店與道具系統 (Economy)
讓獎勵不再只是數字的堆疊，而是具有真實購買力的資產。
- **🐱 橘喵商店**：老師可自訂商店名稱與圖示，上架各種虛擬或實體獎勵卡片。
- **🎒 道具背包**：學生購買後，商品會進入個人「背包」，並扣除對應貨幣。
- **🎫 核銷機制**：採「臨櫃核銷」制，由老師操作扣除道具，並自動記錄使用歷程。

### 2. 金融與職務體系 (Management)
打造班級微型經濟體，體驗真實社會運作。
- **💰 雙層貨幣**：支援 **積分 (Point)**、**小魚乾 (Fish)**、**貓餅乾 (Cookie)** 三種單位換算。
- **📒 擬真存摺**：紀錄每一筆收支（薪資、罰款、消費），支援「撤銷」與「沖銷」功能。
- **️👔 職務薪資**：支援「每週 / 每月 / 每學期」一鍵發薪，可設定班長、路隊長等職務薪資。

### 3. 座位表與教室空間 (Spatial)
用拖曳打造專屬教室佈局。
- **🪑 拖曳式座位表**：全螢幕編輯器，CSS Grid 自由調整行列數（最大 12×12）。
- **🧩 教室物件系統**：內建電腦、講桌、門窗等 11 種物件 + 自訂物件功能。
- **📊 匯出與列印**：支援 Excel 下載與 A4 橫式列印。

### 4. 沉浸式儀表板 (Dashboard)
- **三欄式佈局**：左側日曆/公告、中間任務板、右側村民廣場，資訊一目瞭然。
- **🎫 村民護照**：整合大頭像、職務徽章、資產總覽與任務狀態的個人中心。
- **✨ 30 種動物村民**：可愛的動物 Emoji 頭像（已排除豬），隨機或手動分配。
- **☁️ 資料安全**：Local-First 架構，資料優先儲存於瀏覽器，並支援 Google Drive 雲端備份。

## 🚀 快速開始 (Quick Start)

### 💻 開發環境建置

1.  **Clone 專案**
    ```bash
    git clone https://github.com/your-repo/purr-purr-town.git
    cd purr-purr-town
    ```

2.  **安裝依賴**
    ```bash
    npm install
    ```

3.  **啟動開發伺服器**
    ```bash
    npm run dev
    ```

### ⚙️ 部署至 Github Pages

專案內建 `vite.config.js` 設定，支援一鍵 Build 並部署。

```bash
npm run build
# 將 dist/ 資料夾內容部署至 GitHub Pages
```

---

## 📋 三步驟工作流 (Workflow)

### Step 1: 建村與職務分配 (Setup)
1. 建立班級（輸入代號、學生名單）
2. 進入 **⚙️ 設定 > 職務設定**，建立「班長」、「衛生長」等職務並指派學生
3. 設定 **行為規範**，定義「作業缺交」、「主動助人」等加扣分項目
4. 開啟 **🪑 座位表**，拖曳教室物件與學生完成座位安排

### Step 2: 日常營運 (Daily Operation)
1. **發布任務**：在「今日任務」新增國語習作、數學考卷等事項
2. **狀態追蹤**：在村民廣場點擊學生，標記「準時」、「遲交」或「請假」
3. **快速獎懲**：點擊學生頭像開啟護照，針對課堂表現給予加扣分

### Step 3: 經濟循環 (Economy Cycle)
1. **發放薪資**：每週五或月底，在設定中點擊「發放薪資」，批次入帳
2. **消費獎勵**：表現好的學生可前往「🐱 橘喵商店」購買商品道具
3. **道具核銷**：學生使用道具卡時，老師在護照背包中點擊核銷

---

## 📐 技術架構 (Architecture)

| 層級 | 技術 | 說明 |
|------|------|------|
| **前端框架** | React 19 | 使用最新的 React Hooks 與 Functional Components |
| **建置工具** | Vite 7.0 | 極速的 HMR 開發體驗 |
| **樣式系統** | Tailwind CSS 4 | 使用 Utility-first 快速構建 UI 與 RWD |
| **拖放引擎** | @dnd-kit | 觸控友善的 DnD 框架，驅動座位表拖曳功能 |
| **圖示系統** | Emoji System | v3.4.5 全面改用原生 Emoji，色彩豐富且無額外依賴 |
| **資料儲存** | LocalStorage | JSON 格式儲存班級資料 (`ppt_cache_class_{id}`) |
| **雲端後端** | Google Apps Script | `Code.gs` 提供簡單的 POST/GET API 進行雲端備份 |
| **匯出引擎** | SheetJS (xlsx) | 動態載入，支援座位表與職務表 Excel 匯出 |

---

## 📂 專案結構 (File Structure)

```plaintext
src/
├── components/
│   ├── common/         # 共用元件 (Header, IconPicker, AvatarEmoji...)
│   ├── dashboard/      # 儀表板核心 (SquadGrid, TaskBoard, VillagerCard...)
│   ├── seating/        # v3.7.0 座位表 (SeatingGrid, SeatingCell, SeatingToolbar...)
│   └── modals/         # 功能視窗 (Passport, Settings, Store, History...)
│       └── settings/   # v3.7.0 設定子元件 (JobSettingsTab)
├── utils/
│   ├── constants.js    # 系統參數 (預設商品、行為規範、職務表、座位物件)
│   ├── helpers.js      # 核心邏輯 (銀行交易、資料遷移、ID生成)
│   ├── seatingUtils.js # v3.7.0 座位表純函式 (Grid 操作)
│   └── exportUtils.js  # v3.7.0 匯出工具 (Excel + 列印)
├── views/
│   ├── DashboardView.jsx   # 主控台 (狀態管理中樞)
│   ├── SeatingView.jsx     # v3.7.0 座位表全螢幕編輯器
│   └── LoginView.jsx       # 入口頁
└── App.jsx             # 路由與全域狀態
```

---

## 📝 版本歷程 (Changelog)

### v3.7.0 (2026-02-11) - 村莊建設 🏗️
- **NEW** 新增 **拖曳式座位表**：全螢幕編輯器，支援學生拖曳入座、教室物件放置、視角切換
- **NEW** 內建 **11 種教室物件** + 自訂物件功能，透過圖示選擇器無限擴充
- **NEW** 新增 **職務分類** (幹部/打掃/其他) 與快速分配模式
- **NEW** 新增 **Excel 匯出**：座位表與職務表均可下載 `.xlsx` 檔案
- **NEW** 新增 **列印支援**：A4 橫式輸出座位表，自動隱藏控制項
- **IMPROVE** 修正分頁切換邊框閃爍問題 (PassportModal, SettingsModal)
- **IMPROVE** 從 SettingsModal 抽取 JobSettingsTab 獨立元件，降低複雜度

### v3.6.0 (2026-02-04) - 智慧自動化 ⚡
- **NEW** 實作 **Smart Task Logic**：任務狀態變更時自動觸發獎懲 (每日任務/遲交/缺交)
- **NEW** 新增 **Smart Undo**：更正狀態時自動撤銷舊有的獎懲交易，保持帳目正確
- **NEW** 優化 **批次請假**：護照內新增一鍵請假功能，簡化操作流程
- **IMPROVE** 介面優化：調整資產顯示權重、商品列表排版、移除不必要的資訊顯示
- **FIX** 修正小隊達成率計算邏輯 (排除請假/免除者)

### v3.5.0 (2026-02-03) - 橘喵商店 🛒
- **NEW** 新增「橘喵商店」與道具背包系統
- **NEW** 實作商品庫存管理與臨櫃核銷流程

### v3.4.x (2026-02-01) - 班級職務 💰
- **v3.4.6**：擴充 Emoji 圖示庫，重構行為規範分類邏輯
- **v3.4.5**：修復下拉選單溢出問題，回歸彩色 Emoji 圖示
