# 技術債與待修項目

> 產出日期：2026-03-03
> 來源：v3.8.0 品質審查（code-reviewer + security-reviewer）
> 狀態：同次審查中 CRITICAL / MEDIUM / 部分 HIGH / 部分 LOW 已修復，以下為尚未處理的項目

---

## HIGH

### H3 — Token 以 GET query string 傳送

| 欄位 | 內容 |
|------|------|
| 位置 | `SettingsModal.jsx:117`、`RestoreClassModal.jsx:34`、`Code.gs:20` |
| 說明 | 雲端下載時 token 附加於 URL query（`?token=...`），會出現在瀏覽器歷史、server log、Referer header |
| 未修原因 | GAS Web App 的 `doGet` 不支援 preflight CORS，無法直接改為 POST；需重構 `Code.gs` 讓 `doPost` 同時處理 `backup_download` action，並以 GAS redirect 回應 JSON |
| 建議方案 | 1. `Code.gs` 的 `doPost` 新增 `backup_download` 分支<br>2. 客戶端下載改為 `fetch(url, { method: 'POST', body: JSON.stringify({ action, classId, token }) })`<br>3. 若 CORS 仍受限，可改用 GAS `ContentService` + redirect follow 模式 |
| 影響範圍 | `Code.gs`、`SettingsModal.jsx`、`RestoreClassModal.jsx` |

### H7 — SettingsModal / PassportModal 超過 800 行上限

| 欄位 | 內容 |
|------|------|
| 位置 | `SettingsModal.jsx`（~1135 行）、`PassportModal.jsx`（~865 行，移除死碼後） |
| 說明 | 超出專案 CLAUDE.md 規範的 800 行上限，PassportModal 先前的 leave 死碼正是因檔案過大而遺漏 |
| 未修原因 | 需要完整的元件拆分重構，非 bugfix 能解決 |
| 建議方案 | **SettingsModal**：參照 `JobSettingsTab` 模式，將各 tab 拆為獨立元件（`GeneralSettingsTab`、`BehaviorSettingsTab`、`ShopSettingsTab`、`CurrencySettingsTab`、`AutomationSettingsTab`、`BackupSettingsTab`）<br>**PassportModal**：將 tasks / passbook / edit / inventory 各 tab 拆為獨立元件 |
| 影響範圍 | `components/modals/SettingsModal.jsx`、`components/modals/PassportModal.jsx`、新增 `components/modals/settings/` 與 `components/modals/passport/` 子目錄 |

---

## LOW

### L3 — student.uuid 與 student.id 冗餘

| 欄位 | 內容 |
|------|------|
| 位置 | `App.jsx:28-29`、整個 codebase 的 student 相關邏輯 |
| 說明 | 建立學生時 `uuid` 和 `id` 被設為相同值，後續程式碼中出現 `s.id \|\| s.uuid` 的 fallback pattern，實際上 `uuid` 從未有獨立用途 |
| 未修原因 | 涉及所有 student 物件的序列化格式，需確保既有備份檔案的向後相容 |
| 建議方案 | 1. 新建立的學生只產生 `id`，不再設定 `uuid`<br>2. 載入舊資料時的 `s.id \|\| s.uuid` fallback 保留作為向後相容<br>3. 長期目標：下一次 major version 時移除 `uuid` 欄位 |
| 影響範圍 | `App.jsx`、`DashboardView.jsx`、備份匯入/匯出格式 |

### L4 — 無 Content Security Policy (CSP)

| 欄位 | 內容 |
|------|------|
| 位置 | GitHub Pages 部署設定（`index.html` 或 `_headers`） |
| 說明 | 目前無 CSP header，任何 XSS 漏洞（如本次修復的 C3）都能自由載入外部腳本並存取 LocalStorage |
| 未修原因 | GitHub Pages 不支援自訂 HTTP headers，需透過 `<meta>` tag 實作，且需仔細測試避免阻擋合法資源（GAS fetch、Google Fonts 等） |
| 建議方案 | 在 `index.html` 的 `<head>` 中加入：<br>`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://script.google.com https://script.googleusercontent.com; font-src 'self' https://fonts.gstatic.com">`<br>需實際測試雲端備份、Excel 匯出、列印視窗等功能是否正常 |
| 影響範圍 | `index.html` |

---

## ESLint 殘餘項目（20 個）

修復前 37 個，本次修復 17 個，剩餘 20 個分布如下：

### 可修但需評估影響的

| 檔案 | 問題 | 說明 |
|------|------|------|
| `AnnouncementModal.jsx:19` | `setState` in `useEffect` | `setItems(announcements)` 在 effect 內同步呼叫，應改為 `useMemo` 或直接以 props 初始化 `useState` |
| `TeamManagementModal.jsx:55` | `useMemo` missing dep `defaultGroups` | dependency array 缺少 `defaultGroups`，需確認是否為刻意省略 |
| `SeatingView.jsx:37` | `handleClose` accessed before declaration | `useEffect` 在 `handleClose` 宣告前引用，需調整 hook 順序或改用 ref |
| `PassportModal.jsx:8` | `hasOverdue`、`currentDateStr` unused props | 已從 `DashboardView` 傳入但 modal 內未使用，需同步清理呼叫端 |

### 架構性限制（不建議強行修復）

| 檔案 | 問題 | 說明 |
|------|------|------|
| `LoginView.jsx:15-25` | `Math.random()` in `useMemo` | 浮動 emoji 裝飾用途，`useMemo([], [])` 只執行一次，實務上不造成問題，ESLint react-hooks/purity 規則過嚴 |
| `LoginView.jsx:43` | `Date.now()` in `useMemo` | 備份過期判斷需要當前時間，不可避免 |
| `DashboardView.jsx:564`、`LoginView.jsx:250` | `__APP_VERSION__` is not defined | Vite 全域注入的常數，ESLint 不認識，需在 `eslint.config.js` 中加入 `globals: { __APP_VERSION__: 'readonly' }` |
| `Header.jsx:50,78` | `Icon` is defined but never used | 解構 rename `{ icon: Icon }` 的 false positive，ESLint 無法辨識 destructuring alias 的使用 |
