🔍 **MeowClaw 規範審查報告**

---

### 反例搜尋與壓力測試步驟
在確立推論前，本研究針對以下反例假設進行了獨立檢索與驗證：
1. **反例假設 A**：「是否有主流設計系統明文推崇『多層彈窗堆疊（Nested Modals）』作為標準互動模式？」
   - *驗證結果*：無。各大系統（Apple HIG、Carbon、Atlassian、Material 3）一致將巢狀彈窗列為「應極力避免（Discouraged / Avoid）」的反模式。
2. **反例假設 B**：「對話框外框是否應一律設定全域固定高度（例如 80vh）以求介面齊一？」
   - *驗證結果*：反對。Atlassian 與 Material 3 規範均明文指出對話框高度由「內容決定（determined by content / wrap content）」，僅在內容過長時受最大高度（max-height）限制並觸發內部滾動，禁止在短內容視窗強制撐開空白。

---

### 一、事實（規範原文與具體數值）

#### 1. 巢狀與多層對話框（Nested / Stacked Dialogs）
*   **Apple HIG** 明文指出：「避免同時顯示一個以上的警示框（Avoid displaying more than one alert at a time）」；並在 Modality 規範中要求：「在呈現另一個模態視圖之前，讓使用者先關閉當前的模態視圖（Let people dismiss a modal view before presenting another one）。」[來源 1, 2]
*   **W3C WAI-ARIA APG (Dialog Pattern)** 定義：「對話框是覆蓋在主視窗或其他對話框之上的視窗（A dialog is a window overlaid on either the primary window or another dialog window）。」當一個模態對話框開啟另一個模態對話框時，底層對話框連同背景必須進入 `inert`（不可互動）狀態，且焦點必須完全轉移至最上層對話框[來源 3, 4]。
*   **IBM Carbon Design System** 在組件階層指南中指出：「避免複雜的巢狀結構，因為這會產生堆疊效應（stacking effect），混淆使用者並模糊核心焦點。」當彈窗內包含選單或浮層時，規範要求使用 Portal 確保渲染至最上層 DOM[來源 5, 6]。

#### 2. 對話框高度與尺寸規範
*   **Atlassian Design System** 對 Modal 高度明文規定：「雖然可以配置模態框的寬度，但高度是由其內容決定的（While you can configure the width of a modal, the height is determined by its content.）。一旦內容超過可用的視窗高度，主體內容會滾動，而頁首與頁尾保持固定。」[來源 7]
*   **Material Design 3 (M3)** 規定基本對話框（Basic Dialogs）高度依內容自動包覆（wrap content / adaptive），並依螢幕斷點限制最大寬度與高度（Max constraints），而非使用固定高度填滿視窗[來源 8, 9]。
*   **IBM Carbon Design System** 提供 4 種尺寸（`xs` 320px、`sm` 448px、`md` 640px、`lg` 768px），各級別訂有最大高度限制（Max height），內文超過時觸發內部滾動；短內容對話框尺寸由內部元素決定[來源 10]。

#### 3. 阻斷式對話框與全螢幕覆蓋
*   **W3C WAI-ARIA (Alert and Message Dialogs Pattern)** 規範：`role="alertdialog"` 用於中斷工作流程以傳達重要訊息並強制要求回應（如確認破壞性操作或系統錯誤）。此類別通常不提供通用的右上角關閉鍵（Close button），且不可藉由點擊背景遮罩取消[來源 11, 12]。
*   **Apple HIG (Alerts)** 規範：警示框（Alerts）專用於傳達關鍵資訊或確認操作，必須提供明確的按鈕讓使用者採取行動，不應作為一般的多步驟表單或長期工作區[來源 2, 13]。

#### 4. WAI-ARIA APG 模態對話框無障礙行為清單
依據 **W3C WAI-ARIA APG Dialog (Modal) Pattern** 與 **Alert Dialog Pattern**[來源 3, 11]：
*   **必須具備（MUST / REQUIRED）**：
    1.  **語意角色**：容器節點必須宣告 `role="dialog"`（一般工作視窗）或 `role="alertdialog"`（阻斷式/警示視窗）。
    2.  **模態宣告**：必須標記 `aria-modal="true"`，向輔助科技表明底層內容已隔離。
    3.  **無障礙名稱**：必須使用 `aria-labelledby` 指向對話框標題元素的 `id`；若無可見標題則必須提供 `aria-label`。
    4.  **初始焦點**：對話框開啟時，焦點必須立即移入對話框內的第一個可聚焦元素（若為破壞性 alertdialog，焦點應優先置於「取消」或非破壞性按鈕）。
    5.  **焦點陷阱（Focus Trap）**：使用鍵盤（Tab / Shift + Tab）巡覽時，焦點必須循環停留在對話框內部，絕對不可穿透至背景。
    6.  **背景內容隔離**：對話框開啟期間，背景 DOM 節點必須設定 `inert` 屬性（或全域 `aria-hidden="true"`），防止螢幕閱讀器讀取。
    7.  **焦點還原**：對話框關閉時，焦點必須精確歸還至最初觸發開啟該對話框的互動元素（Trigger element）。
    8.  **鍵盤關閉機制**：一般對話框必須支援按下 `Escape` 鍵關閉。
*   **建議具備（SHOULD / RECOMMENDED）**：
    1.  **無障礙說明**：若對話框有副標題或詳細警告內文，建議使用 `aria-describedby` 指向該內文節點 `id`。
    2.  **點擊遮罩關閉**：非阻斷式的一般對話框，建議支援點擊 Backdrop 關閉以提高操作便利性。

---

### 二、來源（網址與查閱日期）

1.  [Apple HIG - Modality](https://developer.apple.com/design/human-interface-guidelines/modality)（查閱日期：2026-08-18）
2.  [Apple HIG - Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)（查閱日期：2026-08-18）
3.  [W3C WAI-ARIA APG - Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)（查閱日期：2026-08-18）
4.  [W3C HTML spec - The dialog element and inertness](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)（查閱日期：2026-08-18）
5.  [IBM Carbon Design System - Modal Usage](https://carbondesignsystem.com/components/modal/usage/)（查閱日期：2026-08-18）
6.  [IBM Carbon Design System - Component Layering](https://carbondesignsystem.com/elements/layering/overview/)（查閱日期：2026-08-18）
7.  [Atlassian Design System - Modal Dialog](https://atlassian.design/components/modal-dialog/usage)（查閱日期：2026-08-18）
8.  [Material Design 3 - Dialogs Guidelines](https://m3.material.io/components/dialogs/guidelines)（查閱日期：2026-08-18）
9.  [Material Design 3 - Layout Specs](https://m3.material.io/components/dialogs/specs)（查閱日期：2026-08-18）
10. [IBM Carbon Design System - Modal Guidelines & Sizing](https://carbondesignsystem.com/components/modal/style/)（查閱日期：2026-08-18）
11. [W3C WAI-ARIA APG - Alert and Message Dialogs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)（查閱日期：2026-08-18）
12. [W3C WAI-ARIA APG - Alert Dialog Example](https://www.w3.org/WAI/ARIA/apg/example-index/dialog-modal/alertdialog.html)（查閱日期：2026-08-18）
13. [Apple HIG - Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)（查閱日期：2026-08-18）

---

### 三、推論（明確標記為推論）

*   **[推論 1：外框元件必須分流為兩套抽象]**
    依據各大規範對「工作型容器（Full Task Dialog）」與「確認/警示型容器（Alert/Confirmation Dialog）」的行為差異，共用外框不應只有單一固定樣式。系統應實作兩套外框規範：
    - **主要工作視窗（Primary Workspace Frame）**：適用於複雜清單、表單、多分頁（如村莊設定、小隊管理）。採第一輪決議之寬度三級、固定高度與內部滾動、具右上角關閉鍵、支援 Esc 與遮罩點擊關閉、`role="dialog"`。
    - **次級/警示視窗（Alert & Secondary Dialog Frame）**：適用於簡短確認、密碼輸入、同步衝突。寬度強制為 `xs` 或 `sm`，高度必須為 `auto / fit-content`（自適應內容），禁止套用 80vh 固定高度，以避免內容與按鈕間產生不合理的巨大空白。
*   **[推論 2：四個「小視窗」的本質判定與重構方向]**
    1.  *學生護照（交易修正、道具核銷）*：屬於次級確認框。若採用彈窗堆疊，必須使用 Portal 提升層級並將第一層護照設為 `inert`；但更佳的 UX 解法是在護照右側欄位中進行「行內展開（Inline Expansion / Inline Confirm）」，直接免除第二層彈窗。
    2.  *橘貓商店（購買確認）*：屬於次級確認框。同上，宜採用輕量級確認框（寬度小、高度自適應）或在購買按鈕旁做二次點擊確認。
    3.  *評語助手（密碼閘門）*：本質不是「巢狀彈窗」，而是進入評語主視窗前的「前置步驟（Gatekeeper Modal）」。應先以獨立小型驗證框呈現，驗證成功後再以主視窗開啟評語清單（或在同一個外框內由密碼輸入頁切換至評語清單頁），避免雙層疊加。
    4.  *課堂法寶（時間到提示）*：本質不是 Dialog，而是「狀態覆蓋層（Status Overlay / Takeover Banner）」。不應套用任何對話框外框，應採用全螢幕遮罩加中央醒目提示卡片，點擊任意處或空白鍵即可解除。
*   **[推論 3：同步衝突視窗的特殊處理]**
    同步衝突屬於標準的 `role="alertdialog"`。此視窗具有「強制二選一」的排他性，依規範**禁止提供關閉按鈕（X）、禁止點擊遮罩關閉、禁止 Esc 關閉**。其尺寸應採雙版本並列之專屬寬度，但高度應依版本比對卡片內容自適應，不套用一般工作視窗外框。

---

### 四、未知（查證邊界與檢索範圍）

*   **[未知 1：多層巢狀對話框在雙層以上時的螢幕閱讀器通用標準]**
    - *已搜尋範圍*：W3C WAI-ARIA 1.2 規範、WAI-ARIA APG 實作範例、MDN Web Docs。
    - *結果*：W3C 僅規範單一對話框對背景的 `inert` 隔離機制，以及「A dialog overlaid on another dialog」的原則性敘述，並未針對 2 層以上的巢狀焦點堆疊（Stack Data Structure）定義出所有瀏覽器皆保證相容的標準事件規範。

---

### 五、衝突（各家規範矛盾處原文並陳）

*   **衝突點：是否允許在對話框之上再彈出另一個對話框（Nested Modals）？**
    *   **Apple HIG**（嚴格反對）：
        > *"Let people dismiss a modal view before presenting another one. Presenting multiple modal views simultaneously increases cognitive load, creates visual clutter, and can make an app feel disorganized."*（讓使用者在呈現另一個模態視圖前先關閉當前視圖。同時呈現多個模態視圖會增加認知負擔、造成視覺混亂並使應用顯得無序。）
    *   **W3C WAI-ARIA APG**（技術上容許，但要求嚴格焦點隔離）：
        > *"A dialog is a window overlaid on either the primary window or another dialog window. Windows under a modal dialog are inert."*（對話框是覆蓋在主視窗或其他對話框之上的視窗。模態對話框下方的視窗均為惰性/不可互動。）
    *   **IBM Carbon Design System**（架構上警告堆疊效應）：
        > *"Avoid complex nesting of disclosures or modals, as this can create a 'stacking effect' that confuses the user and obscures the primary focus."*（避免展開項或模態框的複雜巢狀結構，因為這會產生混淆使用者並遮蔽主要焦點的「堆疊效應」。）

---

### 六、VERDICT：13 個彈窗套用判準清單

| 編號 | 彈窗名稱 | 判定分類 | 依據說明（一句話） |
| :--- | :--- | :--- | :--- |
| 1 | **村莊設定** | **該套統一外框** | 包含 8 個分頁之複雜配置中心，符合主要工作視窗固定高度與內部滾動規範。 |
| 2 | **小隊管理** | **該套統一外框** | 包含左右雙欄拖放與成員管理，需寬尺寸與固定工作高度以防介面跳動。 |
| 3 | **學生護照** | **該套統一外框**（主體）<br>+ **該用次級對話框樣式**（內含 2 個確認框） | 主體為雙欄資訊工作台適用統一外框；內含之「交易修正」與「道具核銷」屬確認框，高度必須自適應（fit-content），禁止套用工作視窗高度。 |
| 4 | **橘貓商店** | **該套統一外框**（主體）<br>+ **該用次級對話框樣式**（購買確認） | 主體為選單與商品網格適用統一外框；購買確認為短操作，應使用自適應高度小型對話框或行內確認。 |
| 5 | **任務總覽** | **該套統一外框** | 包含篩選與全班長清單，適用標準寬度與內部獨立滾動外框。 |
| 6 | **村莊歷史** | **該套統一外框** | 包含資料篩選與歷史紀錄列表，需依循標準工作視窗高度與滾動約束。 |
| 7 | **評語助手** | **該套統一外框**（主體）<br>+ **該獨立處理**（密碼閘門） | 評語清單主體適用統一外框；前置密碼輸入屬「驗證閘門」，應為獨立小型對話框，通過後再展開催評語主視窗。 |
| 8 | **課堂法寶** | **該套統一外框**（主體）<br>+ **該獨立處理**（時間到提示） | 抽籤與計時器操作適用統一外框；計時結束之「時間到提示」為全螢幕狀態覆蓋層（Status Overlay），非對話框。 |
| 9 | **財富榜** | **該套統一外框** | 包含全班 30 人排行榜清單，需標準工作視窗外框維持標題固定與清單滾動。 |
| 10 | **公告管理** | **該套統一外框** | 包含表單輸入與既有清單瀏覽，適用標準工作型彈窗規範。 |
| 11 | **建立村莊** | **該套統一外框** | 屬於一次性建班多欄位表單，適用工作視窗標準版型。 |
| 12 | **還原村莊** | **該套統一外框** | 包含雲端讀取與檔案上傳表單，適用工作視窗標準版型。 |
| 13 | **同步衝突** | **該獨立處理** | 屬阻斷式 `role="alertdialog"`，無關閉鈕且高度依兩張版本卡片自適應（禁止強制 80vh 空白），行為與工作視窗完全不同。 |
