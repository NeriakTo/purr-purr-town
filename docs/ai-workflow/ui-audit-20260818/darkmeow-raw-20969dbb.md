STATUS: PASS

SUMMARY: 採 3 級寬度、非提示型彈窗固定 85dvh 高度，並將村莊設定升到 `max-w-5xl`，即可讓設定與小隊管理共用同一外框規格。

FINDINGS:

- CRITICAL：無。

- HIGH：村莊設定目前為 `max-w-3xl max-h-[90vh]`，小隊管理為 `max-w-5xl max-h-[90vh]`；兩者的 `max-h` 都只是上限，內容較少時仍會自然縮短，因此截圖呈現 768px／1024px 寬及約 810px／586px 高的雙重跳動。src/components/modals/SettingsModal.jsx:502、src/components/modals/TeamManagementModal.jsx:176

- HIGH：不可把小隊管理降到 `max-w-3xl`。列表需要三欄卡片，編輯狀態還要並排「目前成員／待分配村民」兩個各半工作區；縮到 768px 後，搜尋框、狀態標籤與批次操作會明顯擁擠。src/components/modals/TeamManagementModal.jsx:215、src/components/modals/TeamManagementModal.jsx:276、src/components/modals/TeamManagementModal.jsx:278、src/components/modals/TeamManagementModal.jsx:351

- HIGH：設定分頁共有 8 項，現行是單排 `whitespace-nowrap overflow-x-auto`。實際程式碼中「雲端同步」不是最後一項，後面還有「評語設定」；截圖中雲端同步只露出一部分，代表評語設定已完全離開可視區。src/components/modals/SettingsModal.jsx:466、src/components/modals/SettingsModal.jsx:474、src/components/modals/SettingsModal.jsx:475、src/components/modals/SettingsModal.jsx:523、src/components/modals/SettingsModal.jsx:529

- HIGH：建立村莊、還原村莊等長表單沒有高度限制，也沒有把主要內容指定為獨立捲動區；固定高度時若只換外框類別，內容會被 `overflow-hidden` 裁掉。必須同步改成 `flex flex-col` 與 `flex-1 min-h-0 overflow-y-auto`。src/components/modals/CreateClassModal.jsx:81、src/components/modals/CreateClassModal.jsx:101、src/components/modals/CreateClassModal.jsx:213、src/components/modals/RestoreClassModal.jsx:128、src/components/modals/RestoreClassModal.jsx:134

- HIGH：Passport 是唯一固定 `h-[85vh]` 的主要彈窗，其餘大多是 `max-h` 或完全不限高；這正是切換時高度不穩定的結構原因。src/components/modals/PassportModal.jsx:167、src/components/modals/SettingsModal.jsx:502、src/components/modals/AnnouncementModal.jsx:52

- MEDIUM：頁首存在兩套結構。Settings、Team、Task、Store 使用正常文件流頁首；Announcement、Gadgets、Passport、Create、Restore 則把關閉鈕絕對定位在內容上方；History 又採更小的 `px-4 py-3`、10px 圖示規格。src/components/modals/SettingsModal.jsx:506、src/components/modals/AnnouncementModal.jsx:54、src/components/modals/GadgetsModal.jsx:171、src/components/modals/HistoryModal.jsx:88

- MEDIUM：底部動作順序與定位不一致。Team、Announcement 是「取消 → 儲存」，Settings 卻是「儲存 → 取消」；Announcement 動作列還位於可捲內容內，而非固定 footer。src/components/modals/TeamManagementModal.jsx:449、src/components/modals/TeamManagementModal.jsx:456、src/components/modals/AnnouncementModal.jsx:116、src/components/modals/SettingsModal.jsx:1408

- MEDIUM：主要內距混用 `p-4`、`p-6`、`md:p-8`。History 明顯比 Settings、Team 緊密，Gadgets／Announcement 又會隨斷點放大，造成同級外框內的視覺基準不一致。src/components/modals/HistoryModal.jsx:88、src/components/modals/HistoryModal.jsx:141、src/components/modals/GadgetsModal.jsx:175、src/components/modals/AnnouncementModal.jsx:58

- MEDIUM：遮罩混用 `bg-black/30`、`bg-black/40`、`bg-black/50`，History 沒有模糊；Passport、Wealth 可點遮罩關閉，多數其他彈窗則不能。src/components/modals/CommentModal.jsx:342、src/components/modals/HistoryModal.jsx:83、src/components/modals/SyncConflictModal.jsx:6、src/components/modals/PassportModal.jsx:166、src/components/modals/WealthLeaderboardModal.jsx:72

- MEDIUM：只有 WealthLeaderboard 外框套用 `animate-slide-up`，其餘主要彈窗無進場動畫；現有動畫為 0.4 秒上移 20px，尚未統一處理減少動態偏好。src/components/modals/WealthLeaderboardModal.jsx:73、src/index.css:93、src/index.css:144

- MEDIUM：頂部裝飾條高度混用 `h-2`、`h-3`，Comment 沒有裝飾條，Wealth 則把整個頁首做成漸層。src/components/modals/SyncConflictModal.jsx:8、src/components/modals/SettingsModal.jsx:503、src/components/modals/CommentModal.jsx:343、src/components/modals/WealthLeaderboardModal.jsx:76

DECISIONS:

1. 外框尺寸應統一成 3 級，不應強迫所有內容使用同一寬度。建議級距為：

| 級別 | Tailwind | 彈窗 | 實際內容密度與理由 |
|---|---|---|---|
| S 緊湊 | `max-w-lg`，512px | CreateClassModal | 單欄 5 個基本欄位，加一個條件式設定來源選單；不需要橫向工作區。src/components/modals/CreateClassModal.jsx:101 |
| S 緊湊 | `max-w-lg` | RestoreClassModal | 雲端／檔案兩分頁；雲端是 3 個單欄憑證欄位，檔案頁是上傳區。src/components/modals/RestoreClassModal.jsx:143、src/components/modals/RestoreClassModal.jsx:170 |
| S 緊湊 | `max-w-lg` | SyncConflictModal | 兩張版本比較卡與兩個選擇按鈕；512px 足以保留雙欄。src/components/modals/SyncConflictModal.jsx:21、src/components/modals/SyncConflictModal.jsx:47 |
| S 緊湊 | `max-w-lg` | WealthLeaderboardModal | 單軸排名列、期間切換及匯出，不需要大型工作區。src/components/modals/WealthLeaderboardModal.jsx:95、src/components/modals/WealthLeaderboardModal.jsx:115 |
| M 標準 | `max-w-3xl`，768px | AnnouncementModal | 新增欄位、可捲公告編輯清單及儲存動作；單欄但需要舒適文字編輯寬度。src/components/modals/AnnouncementModal.jsx:69、src/components/modals/AnnouncementModal.jsx:89 |
| M 標準 | `max-w-3xl` | TaskOverviewModal | 多條件篩選、任務摘要與展開後的全班狀態操作。src/components/modals/TaskOverviewModal.jsx:94、src/components/modals/TaskOverviewModal.jsx:134 |
| M 標準 | `max-w-3xl` | HistoryModal | 搜尋、日期、任務類型篩選與展開式補登清單，密度高但仍是單一主欄。src/components/modals/HistoryModal.jsx:103、src/components/modals/HistoryModal.jsx:140 |
| M 標準 | `max-w-3xl` | GadgetsModal | 兩項課堂工具；最大核心元件是 260px 計時器，沒有側欄需求。src/components/modals/GadgetsModal.jsx:186、src/components/modals/GadgetsModal.jsx:209 |
| M 標準 | `max-w-3xl` | CommentModal | 全班統計、API 摺疊設定、批次工具與可展開學生清單。src/components/modals/CommentModal.jsx:375、src/components/modals/CommentModal.jsx:437、src/components/modals/CommentModal.jsx:475 |
| L 工作區 | `max-w-5xl`，1024px | SettingsModal | 8 分頁、雙欄設定區及大量表單；升級後也能與 Team 共用外框。src/components/modals/SettingsModal.jsx:466、src/components/modals/SettingsModal.jsx:775 |
| L 工作區 | `max-w-5xl` | OrangeCatStoreModal | 固定學生側欄加三欄商品格線。src/components/modals/OrangeCatStoreModal.jsx:73、src/components/modals/OrangeCatStoreModal.jsx:125 |
| L 工作區 | `max-w-5xl` | PassportModal | 12 欄中的 4／8 雙區佈局，右側又包含分頁、操作面板與交易表格。src/components/modals/PassportModal.jsx:174、src/components/modals/PassportModal.jsx:291、src/components/modals/PassportModal.jsx:583 |
| L 工作區 | `max-w-5xl` | TeamManagementModal | 三欄小隊卡片以及 50／50 雙面板編輯器。src/components/modals/TeamManagementModal.jsx:215、src/components/modals/TeamManagementModal.jsx:276 |

共用主要外框可直接採用：

```jsx
className="
  relative w-full h-[85dvh] max-h-[48rem]
  overflow-hidden rounded-3xl bg-[#fdfbf7] shadow-2xl
  flex flex-col motion-safe:animate-slide-up
"
```

再附加 `max-w-lg`、`max-w-3xl` 或 `max-w-5xl`。Settings 與 Team 最終都會是 `max-w-5xl h-[85dvh] max-h-[48rem]`。

2. 高度不應再使用內容驅動的 `max-h-[90vh]`；除提示型對話框外，一律固定為 `h-[85dvh] max-h-[48rem]`。頁首與 footer 使用 `shrink-0`，內容使用 `flex-1 min-h-0 overflow-y-auto`。這能讓有資料、空資料及切換分頁時外框都不跳動。唯一明確例外是 SyncConflictModal：它是阻斷式二選一提示，強迫撐成 85dvh 反而破壞訊息層級，應使用 `h-auto max-h-[calc(100dvh-2rem)]`；其內容區仍應設 `overflow-y-auto` 作小螢幕保護。Create、Restore、Wealth 等雖可能內容較少，仍屬完整工作流程，不列入例外。套用固定高度時，若沒有同步調整內層捲動責任，回歸風險為 HIGH。

3. 主方案採 (a) 將 SettingsModal 升到 `max-w-5xl`。這同時解決業主最在意的 Settings／Team 外框差異，也讓 8 個分頁在 1440px 以上筆電完整顯示。不要採 (b)：兩排分頁會因寬度與字型而改變頁首高度，重新引入垂直跳動；不要採 (c)：左側分頁會永久吃掉表單寬度，且屬較大的資訊架構改造。由於平板實際可用寬度仍只有「視窗減 32px」，應把 (d) 限定為 `<lg` 的備援：保留 `overflow-x-auto overflow-y-hidden whitespace-nowrap`，在左右尚可捲時顯示 `w-8 bg-gradient-to-r/from-[#fdfbf7]` 遮罩與 Chevron 按鈕，按鈕呼叫 `scrollBy({ left: ±240, behavior: 'smooth' })`；使用現有 React 與 Lucide 即可，不需第三方依賴。分頁容器需加 `relative`，遮罩加 `pointer-events-none`，箭頭加 `lg:hidden`。

4. 其餘外框規則收斂如下：

   - 頁首：主要彈窗統一 `shrink-0 px-6 py-4 border-b border-[#E8E8E8] flex items-center justify-between`；圖示容器 `size-12 rounded-2xl`，標題 `text-2xl font-bold`，說明 `text-sm`。History 可保留較密的內容列，但不應另縮頁首規格。
   - 關閉鈕：全部放在頁首正常文件流右側，統一 `p-2 rounded-full hover:bg-[#E8E8E8] transition-colors` 與 `<X size={24}>`；移除 `absolute top-* right-*`。SyncConflict 因必須作出資料版本選擇，不提供 X 是合理例外。
   - footer：只有「整窗共用一次提交」的編輯流程顯示固定 footer，採 `shrink-0 border-t border-[#E8E8E8] px-6 py-4 flex justify-end gap-3`，順序固定為取消在左、主要動作在右。Announcement、Create、Settings、Team 應套用；Task、History、Gadgets、Comment 等即時操作／唯讀視窗不放空 footer；Restore、Passport 的分頁專屬動作留在各自內容區。
   - 內距：外層遮罩固定 `p-4`；頁首及 body 水平內距固定 `px-6`，一般 body 為 `p-6`，高密度清單可明確採 `p-4`，但不可再以 `md:p-8` 任意放大。
   - 遮罩：一般彈窗統一 `absolute inset-0 bg-black/40 backdrop-blur-sm`。SyncConflict 疊在同步流程之上，可保留 `z-[60] bg-black/50`。為避免表單誤關與資料遺失，遮罩本身一律不綁 `onClick={onClose}`。
   - 動畫：所有主要 panel 統一 `motion-safe:animate-slide-up`；遮罩可用 `motion-safe:animate-fade-in`。沿用 src/index.css:93 與 src/index.css:144 的既有動畫，不新增依賴。建議把 0.4 秒縮短為 0.2～0.25 秒，降低老師連續操作時的等待感。
   - 頂部裝飾：一般功能彈窗統一 `h-3 shrink-0`；SyncConflict 可用 `h-2` 表達次級阻斷層。Wealth 與 Comment 若要完整同系統感，也應新增 `h-3`，而不是以整塊彩色頁首取代外框裝飾。

NEXT: 先抽出共用 `ModalShell`／尺寸常數並優先改 SettingsModal、TeamManagementModal 做 1440×900 與 768×1024 視覺回歸；接著分批遷移其餘彈窗。現況已實跑 `npm run build`，結果 `✓ built in 2.10s`；`npm test -- --run` 結果為 5 個測試檔、52 項測試全部通過。
