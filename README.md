# 🐾 呼嚕嚕小鎮 (Purr Purr Town)

![Version](https://img.shields.io/badge/version-2.1.0-A8D8B9?style=flat-square)
![React](https://img.shields.io/badge/React-19-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-gray?style=flat-square)

**讓班級管理變得像遊戲一般療癒！**

呼嚕嚕小鎮是一個專為教師設計的 **Local-First (本地優先)** 班級管理網頁應用程式。透過溫馨的村莊主題、可愛的動物村民，將繁瑣的作業檢查、小隊管理與課堂互動變得輕鬆有趣。

---

## 🚀 v2.1.0 更新功能

- **🏠 架構重構 (BYOB)**：轉為「本地優先」架構，資料預設儲存於瀏覽器，操作零延遲。
- **🐻 全新村民形象**：改用更可愛、載入更快的 **動物 Emoji 頭像系統**，告別圖片載入問題。
- **💾 雙重備份機制**：新增 **JSON 檔案匯入/匯出** 功能，並支援選用的 **Google Apps Script (GAS) 雲端備份**。
- **🧰 課堂法寶**：新增「專注計時器 ⏳」與「幸運抽籤 🎲」小工具。
- **⚡️ 任務總覽優化**：支援批次完成、刪除任務，以及更直覺的狀態切換。

---

## ✨ 核心功能

### 1. 🏘️ 村莊管理 (Dashboard)
- **多班級切換**：可建立多個村莊（班級），自訂學年度與別名（如「跳跳虎村」）。
- **視覺化儀表板**：即時顯示今日任務達成率。
- **日曆導航**：無縫切換日期，回顧歷史任務紀錄。

### 2. 📝 任務與作業追蹤
- **今日島務**：快速發布作業、訂正、攜帶物品等任務。
- **自動圖示匹配**：根據任務名稱（如「國語」、「美術」）自動顯示對應 Icon。
- **村民廣場**：以小隊分組顯示學生卡片，進度條一目瞭然。
- **欠交警示**：若學生有歷史任務未完成，卡片右上角會出現紅點提示 🔴。

### 3. 📊 任務總覽 & 批次處理
- **跨日期檢視**：一次查看所有任務的完成狀況。
- **批次完成**：老師可勾選多名學生，一鍵標記為「完成」。
- **篩選器**：可依照「未完成」、「已完成」或任務類型進行篩選。

### 4. 🪪 村民護照 (Student Passport)
- **個人檔案**：檢視座號、小隊、姓名。
- **補交作業**：列出該生所有「歷史未完成」任務，方便補救教學與補交。
- **完整紀錄**：查閱該生的所有任務歷史。
- **狀態管理**：支援「完成」、「請假」、「免交」三種狀態。

### 5. 🚩 小隊管理
- **直覺拖曳 (或點選)**：視覺化的小隊分配介面。
- **搶人模式**：在編輯小隊時，可直接搜尋並將學生從其他小隊「移入」。
- **自訂名稱**：可為 A~F 小隊設定專屬別名（如「火箭隊」）。

### 6. 🎥 投影專注模式 (Focus View)
- **黑板風格**：深色背景、粉筆字體，適合投放到教室大螢幕。
- **今日清單**：清晰展示當日所有任務，讓學生一進教室就知道要做什麼。

---

## 🛠️ 技術架構

本專案採用 **Local-First (本地優先)** 架構，意味著：

1.  **資料自主**：所有資料（學生名單、任務紀錄）預設儲存在您瀏覽器的 `localStorage` 中。
2.  **離線可用**：即使沒有網路，您依然可以操作所有功能。
3.  **雲端選用**：我們提供一個輕量的 Google Apps Script (GAS) 腳本，讓您可以將本地資料「整包」備份到自己的 Google Sheet。

**技術棧：**
- **Frontend**: React 19, Vite 7
- **Styling**: Tailwind CSS 4, Lucide React (Icons)
- **Logic**: Date-fns
- **Backend (Optional)**: Google Apps Script (作為 Key-Value Store)

---

## 📦 安裝與部署

### 本地開發
```bash
# 1. 下載專案
git clone [https://github.com/your-username/purr-purr-town.git](https://github.com/your-username/purr-purr-town.git)

# 2. 安裝依賴
npm install

# 3. 啟動開發伺服器
npm run dev
```

### 部署至 GitHub Pages
```bash
# 確保 vite.config.js 中的 base 設定正確
npm run build
npm run deploy
```

## 🔧 專案結構

```text
purr-purr-town/
├── public/              # 靜態資源
│   ├── .nojekyll       # 讓 GitHub Pages 正確處理底線開頭檔案
│   └── vite.svg        # 網站圖標
├── src/
│   ├── App.jsx         # 主應用程式組件（含所有頁面與 Modal）
│   ├── main.jsx        # 應用程式入口點
│   └── index.css       # 全域樣式、動畫、Tailwind 設定
├── index.html          # HTML 模板
├── package.json        # 專案依賴與腳本
├── vite.config.js      # Vite 設定 (含 Base路徑配置)
└── README.md           # 專案說明文件
```

---

## ☁️ 設定雲端備份 (選用)

本專案採用 **Local-First** 架構，即使不連網也能正常使用。若您希望跨裝置同步或備份資料，可依照以下步驟部署專屬的 Google Apps Script (GAS) 後端：

1.  **建立 Google Sheet**：
    - 在您的 Google Drive 建立一個新的試算表（名稱自訂，例如：`呼嚕嚕小鎮資料庫`）。

2.  **開啟 Apps Script**：
    - 點擊上方選單的 `擴充功能` > `Apps Script`。

3.  **貼上後端程式碼**：
    - 將專案提供的 `Code.gs` 內容完整複製並貼上，覆蓋原本的內容。
    - 點擊存檔（磁片圖示）。

4.  **部署為網頁應用程式**：
    - 點擊右上角藍色的 `部署` 按鈕 > `新增部署`。
    - 點擊齒輪圖示 ⚙️ > 選擇 `網頁應用程式`。
    - **設定如下 (重要！)**：
        - **執行身分**：`我 (Me)`
        - **誰可以存取**：`任何人 (Anyone)`
    - 點擊 `部署`。

5.  **連結至村莊**：
    - 複製部署完成後的 **網頁應用程式網址** (以 `https://script.google.com/.../exec` 結尾)。
    - 回到呼嚕嚕小鎮網頁。
    - 點擊右上角 `⚙️ 設定` > `☁️ 雲端備份中心`。
    - 在「GAS 部署網址」欄位貼上剛剛複製的連結。
    - 點擊 `☁️ 雲端上傳` 測試連線，若顯示「備份成功」即完成設定。

---

## 📄 授權

本專案採用 **MIT License** 授權。
這意味著您可以免費使用、修改並分享此專案，無論是用於個人教學或商業用途。

---

_Designed with ❤️ for Teachers._