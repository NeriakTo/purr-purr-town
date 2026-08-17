🔍 貓爪針對彈窗尺寸規範、可用性證據、高度機制與分頁溢出處理進行了設計系統文獻與可用性研究查證，結構化報告如下：

---

### 事實：

#### 1. 主流設計系統對 Dialog / Modal 的尺寸規範（單一固定 vs 分級制）
*   **Material Design 3 (M3)**：
    *   **機制**：單一基準上限規範（搭配 Viewport 響應）。
    *   **數值**：標準 Basic Dialog 的最大寬度規範為 **560dp**（最小寬度 280dp）；在手機螢幕上則維持兩側固定邊距（Margin 24dp/16dp），在大螢幕（桌面/平板）上居中且不超過 560dp。
*   **Carbon Design System (IBM)**：
    *   **機制**：明確四級分級制（T-shirt Sizing）。
    *   **數值**：
        *   `xs`：寬度佔 Viewport 20%（適用於單行確認、簡易警告）。
        *   `sm`：寬度佔 Viewport 32%（適用於短表單、簡易輸入）。
        *   `md`（預設 Default）：寬度佔 Viewport 48%（適用於標準資料輸入）。
        *   `lg`：寬度佔 Viewport 64%（適用於資料表格 Data Table、多欄複雜表單）。
*   **Atlassian Design System**：
    *   **機制**：明確四級分級制 + 全螢幕（Named Sizes）。
    *   **數值**：
        *   `small`：400px。
        *   `medium`（預設 Default）：600px。
        *   `large`：800px。
        *   `x-large`：980px。
        *   `fullscreen`：100vw / 100vh（當 Viewport < 480px 時自動降級為 full-screen）。
*   **Ant Design (AntD 5.x)**：
    *   **機制**：單一預設值 + 任意數值覆寫。
    *   **數值**：預設寬度為 **520px**（`width: 520`）。官方未定義強制性的 xs/sm/md/lg enum，由開發者依場景自行傳入 px 或百分比。
*   **Apple Human Interface Guidelines (HIG - macOS / iPadOS)**：
    *   **機制**：情境分級（Alerts / Sheets / Modals）。
    *   **數值**：
        *   Alert（警告對話框）：固定寬度 260pt（macOS）/ 270pt（iOS）。
        *   Sheet（工作表）：在 iPadOS 上標準 `formSheet` 固定寬度為 **540pt**；在 macOS 上由內容撐開或貼合視窗。
        *   PageSheet / FullScreen：大螢幕上尺寸隨系統 detents 調整。
*   **Radix UI / shadcn/ui**：
    *   **機制**：Radix UI 為 Headless（完全無尺寸規範，由上層決定）；shadcn/ui 的 Dialog 元件預設採用 Tailwind **`max-w-lg`（32rem = 512px）**，並在文件範例中指引透過 `sm:max-w-md`、`sm:max-w-xl` 等 Tailwind breakpoint 進行場景調整。

#### 2. 「彈窗尺寸不一致」之可用性研究與規範原文
*   **Nielsen Norman Group (NN/g) - 一致性原則（Jakob's Heuristic #4 Consistency and Standards）**：
    *   NN/g 在《Modal & Nonmodal Dialogs》與《Internal Consistency in Web Design》中明確指出：**內部一致性（Internal Consistency）**是降低認知負荷的關鍵。使用者會依據過去的操作建立位置記憶與心智模型。
    *   NN/g 指出：頻繁變動彈窗的尺寸與位置，會破壞使用者的「視覺錨點（Visual Anchoring）」，強迫視線進行重新掃描（Visual Re-scanning），增加認知與辨識成本。
    *   但 NN/g 同時警示「不可採用盲目的容器優先（Container-first）策略」——如果將大量複雜資料強塞進過小的固定容器，或將兩行字的確認視窗強行撐到超大，會引發更嚴重的可用性災難（如過度捲動或資訊孤島）。
*   **Carbon & Atlassian 設計系統明文指引**：
    *   兩大系統均明文要求：**同一產品內應遵守有限的級距（Restricted Set of Sizes），禁止隨意自訂 Arbitrary Pixel**。其核心目的是維持產品視覺韻律的一致性，同時讓使用者一看到視窗寬度就能預期該操作是「簡單確認（xs/sm）」還是「深層編輯（lg/xl）」。

#### 3. 彈窗高度規範（內容自適應 vs 固定高度）
*   **主流設計系統共同標準（M3 / Carbon / Atlassian / AntD）**：
    *   **外框高度原則**：**高度一律「內容自適應（Content-driven dynamic height）」，但必須設定最大高度上限（Max-height cap）**。
    *   **結構定義**：
        1.  Header（標題列）：固定置頂（Sticky Header），不隨內容捲動。
        2.  Body（內容區）：高度自適應；當內容高度超過 Max-height 時，觸發內部垂直捲動（`overflow-y: auto`）。
        3.  Footer（操作按鈕區）：固定置底（Sticky Footer），永遠可見，不隨內容捲動。
    *   **上限數值慣例**：各家規範的 Max-height 通常設在 `80vh` ~ `90vh`（或距離螢幕上下各保留 40px~64px 邊距）。

#### 4. 分頁（Tabs）超出寬度時的主流規範
*   **Nielsen Norman Group (NN/g - 《Tabs, Used Right》)**：
    *   **嚴格禁止「換行成兩排（Stacked / Multi-row Tabs）」**：NN/g 列為重大反模式（Anti-pattern）。因為點擊第二排分頁時，分頁列順序或位置會跳動，徹底破壞分頁與下方內容的空間相鄰性（Spatial Adjacency）。
*   **Material Design 3**：
    *   採用 **Scrollable Tabs（水平捲動分頁）**，並強制要求在邊界加上漸層遮罩（Edge Fade）或左右箭頭引導，明確提示「還有後續分頁」。
*   **Ant Design**：
    *   預設機制為 **「More」下拉摺疊選單**：水平空間不足時，自動將放不下的分頁收進右側的「...」下拉選單；同時支援水平滾動。
*   **Carbon Design System & Atlassian**：
    *   當分頁超過 5~7 個且水平空間受限，或分頁屬於「系統層級設定（Settings）」時，官方指引強烈建議 **改採「側邊垂直分頁 / 導覽清單（Vertical Tabs / Side Navigation）」**。

---

### 來源：

1.  **Material Design 3 (Dialogs Specs)**: `https://m3.material.io/components/dialogs/specs` (查閱日期: 2026-08-18)
2.  **Carbon Design System (Modal Guidelines & Sizing)**: `https://carbondesignsystem.com/components/modal/usage/` (查閱日期: 2026-08-18)
3.  **Atlassian Design System (Modal Dialog Specs)**: `https://atlassian.design/components/modal-dialog/` (查閱日期: 2026-08-18)
4.  **Ant Design (Modal Component API)**: `https://ant.design/components/modal` (查閱日期: 2026-08-18)
5.  **Apple Developer Documentation (HIG - Modality & Sheets)**: `https://developer.apple.com/design/human-interface-guidelines/sheets` (查閱日期: 2026-08-18)
6.  **shadcn/ui (Dialog Component Documentation)**: `https://ui.shadcn.com/docs/components/dialog` (查閱日期: 2026-08-18)
7.  **Nielsen Norman Group (Modal & Nonmodal Dialogs)**: `https://www.nngroup.com/articles/modal-nonmodal-dialogs/` (查閱日期: 2026-08-18)
8.  **Nielsen Norman Group (Tabs, Used Right - 12 Guidelines)**: `https://www.nngroup.com/articles/tabs-used-right/` (查閱日期: 2026-08-18)
9.  **Nielsen Norman Group (Horizontal Scrolling on Desktop)**: `https://www.nngroup.com/articles/horizontal-scrolling/` (查閱日期: 2026-08-18)

---

### 推論：

*   **推論 1（尺寸分級對老師心理的影響）**：
    *   業主（小學老師）之所以覺得「像兩套系統」，主因並非「小隊管理與村莊設定尺寸不同」，而是現況混用了 7 種 Arbitrary Sizing（448px、768px、1024px、不限高、85vh 等），缺乏統一的視覺邊界律動與內部佈局語法。
*   **推論 2（視線重置與操作疲勞）**：
    *   小學老師在課堂操作情境下具有「高時間壓力、高頻中斷、非技術背景」特質。若彈窗每次彈出的寬度、高度與按鈕位置隨機跳動，視線必須重新定位尋找關閉按鈕與主要操作鍵，會顯著增加認知負荷。
*   **推論 3（8 個分頁擠在 768px 的病因）**：
    *   村莊設定之所以擠壓，是因為它本質上是一個「多模組設定中心（Settings Hub）」，強行用水平分頁塞在 768px 彈窗中本質上是版面選型錯誤。改用垂直側欄分頁（Master-Detail）才能根治水平捲動問題。

---

### 未知：

*   **已搜尋範圍**：
    *   搜尋 Google Scholar、ACM Digital Library 與 NN/g 論文庫中針對「K-12 教育軟體／教師專用後台彈窗尺寸可用性」之專門論文。
*   **查不到的項目**：
    *   未查到針對「小學教師專用 Web 工具彈窗尺寸特定標準」的獨立量化研究；目前行業均是直接套用通用 B2B SaaS（如 Google Classroom、Canvas LMS、Atlassian）之設計系統原則。

---

### 衝突：

*   **衝突 1：彈窗寬度哲學（單一嚴格限制 vs 多級分級制）**
    *   *Material Design 3* 原文立場：Dialog 本質是輔助與簡短中斷，最大寬度強烈收斂在 560dp，超過者應使用 Full-screen Dialog 或獨立頁面。
    *   *Carbon / Atlassian* 原文立場：企業級工作流程需要乘載複雜資料（如 800px~980px 的 Data Table 與多欄表單），因此必須提供 4~5 級明確級距（sm/md/lg/xl）。
*   **衝突 2：分頁超出時的處置（水平捲動 vs 收進下拉選單 vs 側邊欄）**
    *   *Material Design* 鼓勵 Scrollable Tabs（允許水平滾動，透過 Edge Fade 提示）。
    *   *NN/g 與 Carbon* 則反對桌面端使用水平滾動（Desktop Horizontal Scrolling is an Anti-pattern），主張超過 5~7 項應轉為 Vertical Tabs（垂直分頁）或「More」Dropdown。

---

### RECOMMENDATION：

1.  **實施嚴格三級寬度規範**：全系統彈窗寬度全面收斂為三級（Small: 480px / Medium: 640px / Large: 960px~1024px），全面廢除現況混用的 7 種 Arbitrary 寬度。
2.  **固定外框上限 + 內容自適應**：全系統彈窗一律採用 `max-h-[85vh]`，Header 與 Footer 永久固定置頂/置底，僅中間 Body 區隨內容自適應高度並在溢出時內部垂直捲動。
3.  **村莊設定升級為 Large 級距 + 側邊垂直分頁**：村莊設定（8 個分頁）屬於重度設定，應升級為 Large 寬度（960px~1024px），並將上方水平捲動分頁重構為「左側直式分頁導覽、右側設定面板」，徹底解決分頁擠壓與視線不一致問題。
