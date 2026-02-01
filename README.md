# 🐾 呼嚕嚕小鎮 (Purr Purr Town)

![Version](https://img.shields.io/badge/version-3.3.0-A8D8B9?style=flat-square)
![React](https://img.shields.io/badge/React-19-blue?style=flat-square)
![License](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-lightgrey?style=flat-square)

**班級管理？交給村長就對了！**

呼嚕嚕小鎮是一款給老師們的 **Local-First** 班級管理工具。用溫馨的村莊主題包裝繁瑣的日常——作業追蹤、小隊編組、課堂互動，通通變得像在經營一座可愛的小村莊。資料存在你自己的瀏覽器裡，不用擔心隱私，打開就能用。

---

## 🆕 v3.3.0 更新摘要

- **區塊 Icon 色彩區隔**：三大區塊（日誌、任務、廣場）的標題 Icon 改用不同色系，一眼就能辨識。
- **布告欄文字放大**：便利貼內容更好讀了，不用再瞇著眼睛。
- **村民卡片呼吸空間**：座號標籤不再被切掉，卡片之間也更寬敞。
- **RWD 響應式佈局**：手機、平板也能瀏覽儀表板，三欄會自動堆疊成單欄。
- **授權變更**：從 MIT 轉為 CC BY-NC-SA 4.0，確保教育現場免費使用、禁止商業用途。

---

## ✨ 核心功能一覽

### 🏘️ 村莊儀表板
- 支援多班級（多村莊）管理，每個村莊可以取自己的名字。
- 即時達成率，今天交了多少、還差多少，一目瞭然。
- 日曆導航，隨時回顧任何一天的任務紀錄。

### 📝 今日任務
- 快速發布作業、訂正、攜帶物品等任務，系統會自動幫你配上對應的小圖示。
- 進度條顯示每項任務的完成比例。
- 投影模式一鍵切換，黑板風格大字體，投到教室螢幕上剛剛好。

### 🏠 村民廣場
- 學生卡片依小隊分組排列，誰完成了、誰還沒交，看顏色就知道。
- 有歷史欠交的村民，卡片上會亮紅燈提醒你。

### 🪪 村民護照
- 點開任一學生，查看個人檔案、補交紀錄、歷史任務。
- 支援「完成」、「遲交」、「請假」、「免交」等多種狀態標記。

### 📊 任務總覽
- 跨日期一覽所有任務的繳交狀況。
- 批次勾選、一鍵標記完成，不用一個一個點。

### 🚩 小隊管理
- 拖曳或點選就能分組，還可以幫小隊取帥氣的名字。
- 搶人模式：直接把其他隊的人拉過來。

### 🎲 課堂法寶
- 專注計時器、幸運抽籤，上課小工具隨手可用。

### 📌 村莊布告欄
- 在軟木塞風格的布告欄上釘便利貼，重要公告一進頁面就看到。

---

## 🛠️ 技術架構

**Local-First** 設計，所有資料存在瀏覽器的 `localStorage`，離線也能用。需要跨裝置同步的話，可以選用 Google Apps Script 雲端備份。

| 項目 | 技術 |
|------|------|
| Frontend | React 19, Vite 7 |
| Styling | Tailwind CSS 4, Lucide React |
| Utilities | Date-fns |
| Backend (選用) | Google Apps Script |

---

## 📦 快速開始

```bash
# 下載
git clone https://github.com/your-username/purr-purr-town.git

# 安裝
npm install

# 開發
npm run dev
```

### 部署到 GitHub Pages

```bash
npm run build
npm run deploy
```

---

## 🔧 專案結構

```text
purr-purr-town/
├── public/                # 靜態資源
├── src/
│   ├── App.jsx            # 主應用程式
│   ├── main.jsx           # 入口點
│   ├── index.css          # 全域樣式與動畫
│   ├── components/
│   │   ├── calendar/      # 日曆導航
│   │   ├── common/        # Header、Avatar、Loading
│   │   ├── dashboard/     # BulletinBoard、TaskBoard、VillagerCard、SquadGrid
│   │   └── modals/        # 各種互動彈窗
│   ├── views/             # DashboardView、FocusView、LoginView
│   └── utils/             # 常數與工具函式
├── package.json
├── vite.config.js
└── README.md
```

---

## ☁️ 設定雲端備份（選用）

不設定也完全沒問題，所有功能都能離線使用。如果你想跨裝置同步資料：

1. 在 Google Drive 建一個新的試算表。
2. 開啟「擴充功能 → Apps Script」，貼上專案提供的 `Code.gs`。
3. 部署為「網頁應用程式」（執行身分：我、存取：任何人）。
4. 把部署網址貼到小鎮的「設定 → 雲端備份中心」，測試上傳成功就完成了。

---

## 📄 授權

本專案採用 **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant)** 授權條款。

**簡單來說：**
- ✅ 教育現場、個人使用：**完全免費**，歡迎自由使用與修改。
- ✅ 分享與改作：只要標示原作者、以相同條款分享即可。
- ❌ **禁止商業使用**：未經作者書面授權，不得將本專案或其衍生作品用於任何商業目的（包括但不限於販售、收費服務、商業平台整合等）。

如有商業授權需求，請與作者聯繫。

---

_Designed with ❤️ for Teachers._
