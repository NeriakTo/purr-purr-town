STATUS: PASS

SUMMARY: 13 個主要彈窗都應統一外框，但 Comment、Gadgets、商店與護照內的次級對話框不可硬套主 ModalShell；最大風險集中在長表單裁切、複合捲動區及內嵌絕對定位遮罩。

TABLE:

| 彈窗 | 是否套 ModalShell | 寬度級 | 高度策略 | 破例理由 | 套用時必須同時改的結構 |
|---|---|---|---|---|---|
| AnnouncementModal | 是 | M `max-w-3xl` | 固定 | 無 | 現在整頁包在單一 `p-6/md:p-8`，公告清單才有 `max-h-[45vh]`，footer 也在同一內容塊。必須拆成固定 header、`flex-1 min-h-0 overflow-y-auto` 內容、固定 footer；移除清單自身的 45vh 高度與絕對定位關閉鈕。src/components/modals/AnnouncementModal.jsx:52、src/components/modals/AnnouncementModal.jsx:58、src/components/modals/AnnouncementModal.jsx:89、src/components/modals/AnnouncementModal.jsx:116 |
| CommentModal | 部分 | 主畫面 M `max-w-3xl`；密碼閘門維持 compact `max-w-sm` | 主畫面固定；密碼閘門自適應 | 密碼閘門是另一個阻擋式小視窗，不應被撐成主畫面高度 | 主畫面套 Shell；把標題列留在 header，統計、API 摺疊區及批次工具移入可捲內容頂端，內容補 `min-h-0`。密碼閘門改用獨立 `CompactDialog`。src/components/modals/CommentModal.jsx:295、src/components/modals/CommentModal.jsx:299、src/components/modals/CommentModal.jsx:341、src/components/modals/CommentModal.jsx:345、src/components/modals/CommentModal.jsx:392、src/components/modals/CommentModal.jsx:476 |
| CreateClassModal | 是 | S `max-w-lg` | 自適應例外 | 已定案的 S 級長表單例外 | 目前外框不是 `flex-col`，整份表單沒有捲動區。Shell 仍須使用 `max-h-[calc(100dvh-2rem)]`，表單內容獨立捲動；提交鈕移到 footer，透過 `form` 屬性連回表單；移除絕對定位關閉鈕及底部裝飾條對高度的隱性占用。src/components/modals/CreateClassModal.jsx:81、src/components/modals/CreateClassModal.jsx:89、src/components/modals/CreateClassModal.jsx:101、src/components/modals/CreateClassModal.jsx:204、src/components/modals/CreateClassModal.jsx:213 |
| GadgetsModal | 部分 | M `max-w-3xl` | 固定 | 主視窗套 Shell；時間到警示是內嵌次級 alert | 現有內容捲動基本正確，但標題位於捲動區、關閉鈕絕對定位；須拆出 header。`timeUp` 遮罩必須繼續是 Shell 面板的直接子層，不能被放進可捲內容。src/components/modals/GadgetsModal.jsx:169、src/components/modals/GadgetsModal.jsx:171、src/components/modals/GadgetsModal.jsx:175、src/components/modals/GadgetsModal.jsx:367；src/index.css:334 |
| HistoryModal | 是 | M `max-w-3xl` | 固定 | 無 | 結構最接近目標。header、篩選列保持 `shrink-0`，任務清單交由呼叫端管理捲動；主要只需改 Shell 與固定高度。src/components/modals/HistoryModal.jsx:84、src/components/modals/HistoryModal.jsx:88、src/components/modals/HistoryModal.jsx:104、src/components/modals/HistoryModal.jsx:141 |
| OrangeCatStoreModal | 部分 | L `max-w-5xl` | 固定 | 主商店套 Shell；購買確認是內嵌 compact dialog | Shell 內容必須用 caller-managed 模式，保留左側學生清單與右側商品區各自捲動。訊息列需 `shrink-0` 或納入內容頂端；購買確認遮罩保持 Shell 面板直接子層，不能進入右側捲動區。src/components/modals/OrangeCatStoreModal.jsx:62、src/components/modals/OrangeCatStoreModal.jsx:73、src/components/modals/OrangeCatStoreModal.jsx:75、src/components/modals/OrangeCatStoreModal.jsx:100、src/components/modals/OrangeCatStoreModal.jsx:164 |
| PassportModal | 部分 | L `max-w-5xl` | 固定 | 主護照套 Shell；交易修正與道具核銷是內嵌 compact dialogs | 保留 12 欄格線、左右區各自捲動及右側分頁內容捲動；新增正常文件流 header，移除絕對關閉鈕；補 `max-h-[48rem]`。兩個確認遮罩必須留在 Shell 面板直接子層。src/components/modals/PassportModal.jsx:167、src/components/modals/PassportModal.jsx:169、src/components/modals/PassportModal.jsx:174、src/components/modals/PassportModal.jsx:176、src/components/modals/PassportModal.jsx:292、src/components/modals/PassportModal.jsx:310、src/components/modals/PassportModal.jsx:787、src/components/modals/PassportModal.jsx:857 |
| RestoreClassModal | 是 | S `max-w-lg` | 自適應例外 | 已定案的 S 級動態表單例外 | 外框改 `flex-col`；分頁內容須獨立捲動，檔案摘要可能令高度增加。雲端／檔案動作按鈕移到條件式 footer；移除絕對關閉鈕。src/components/modals/RestoreClassModal.jsx:128、src/components/modals/RestoreClassModal.jsx:130、src/components/modals/RestoreClassModal.jsx:134、src/components/modals/RestoreClassModal.jsx:170、src/components/modals/RestoreClassModal.jsx:240、src/components/modals/RestoreClassModal.jsx:261 |
| SettingsModal | 是 | L `max-w-5xl` | 固定 | 無 | 採 caller-managed 捲動：標題是 header，八分頁列為 `shrink-0`，分頁內容保留唯一縱向捲動，動作列進 footer。不得讓 Shell 再包一層 `overflow-y-auto`。src/components/modals/SettingsModal.jsx:466、src/components/modals/SettingsModal.jsx:502、src/components/modals/SettingsModal.jsx:506、src/components/modals/SettingsModal.jsx:523、src/components/modals/SettingsModal.jsx:541、src/components/modals/SettingsModal.jsx:1408 |
| SyncConflictModal | 是 | S `max-w-lg` | 自適應例外 | 阻斷式版本二選一，且沒有一般關閉行為 | 使用 Shell 的 blocking layer、隱藏關閉鈕、禁止背景關閉。拆成 header、可捲比較內容與固定選擇 footer；保留 `z-[60]`。src/components/modals/SyncConflictModal.jsx:5、src/components/modals/SyncConflictModal.jsx:7、src/components/modals/SyncConflictModal.jsx:10、src/components/modals/SyncConflictModal.jsx:21、src/components/modals/SyncConflictModal.jsx:47 |
| TaskOverviewModal | 是 | M `max-w-3xl` | 固定 | 無 | header 與篩選列目前缺 `shrink-0`，清單缺 `min-h-0`。改為 caller-managed：header、固定篩選列、`flex-1 min-h-0 overflow-y-auto` 清單。src/components/modals/TaskOverviewModal.jsx:78、src/components/modals/TaskOverviewModal.jsx:94、src/components/modals/TaskOverviewModal.jsx:134 |
| TeamManagementModal | 是 | L `max-w-5xl` | 固定 | 無 | 採 caller-managed 捲動，保留列表模式單捲動及編輯模式左右各自捲動；header/footer 交給 Shell 並確保 `shrink-0`。不可把整個 50/50 編輯工作區套上 Shell 的單一捲動。src/components/modals/TeamManagementModal.jsx:176、src/components/modals/TeamManagementModal.jsx:180、src/components/modals/TeamManagementModal.jsx:211、src/components/modals/TeamManagementModal.jsx:276、src/components/modals/TeamManagementModal.jsx:318、src/components/modals/TeamManagementModal.jsx:378、src/components/modals/TeamManagementModal.jsx:448 |
| WealthLeaderboardModal | 是 | S `max-w-lg` | 固定 | 無；不屬三個自適應例外 | 現有 header/list/footer 已符合三段式，只需轉交 Shell、改固定高度及移除專屬外框動畫。期間切換可放內容頂端，清單補 `min-h-0`。src/components/modals/WealthLeaderboardModal.jsx:73、src/components/modals/WealthLeaderboardModal.jsx:76、src/components/modals/WealthLeaderboardModal.jsx:97、src/components/modals/WealthLeaderboardModal.jsx:116、src/components/modals/WealthLeaderboardModal.jsx:187 |

`CommentPanel.jsx` 不納入 ModalShell。它只回傳一張表單面板，沒有遮罩、定位或對話框外框，並由 CommentModal 展開列掛載。src/components/modals/CommentPanel.jsx:72、src/components/modals/CommentModal.jsx:523

SHELL:

建議 props：

| 名稱 | 型別 | 預設值 | 用途 |
|---|---|---:|---|
| `size` | `'S' \| 'M' \| 'L'` | `'M'` | 三級寬度 |
| `height` | `'fixed' \| 'auto'` | `'fixed'` | 固定 85dvh 或三個 S 級例外 |
| `scroll` | `'shell' \| 'caller'` | `'shell'` | 單一內容捲動或複合工作區自行管理 |
| `header` | `ReactNode` | 必填 | 頁首內容 |
| `headerActions` | `ReactNode` | `null` | 匯出、返回等頁首動作 |
| `footer` | `ReactNode` | `null` | 固定底部動作列 |
| `children` | `ReactNode` | 必填 | 主要內容 |
| `accent` | `ReactNode` | `null` | 頂部裝飾條 |
| `onClose` | `() => void` | `undefined` | 關閉事件 |
| `showClose` | `boolean` | `true` | SyncConflict 設為 `false` |
| `closeDisabled` | `boolean` | `false` | 提交中禁止關閉 |
| `closeOnBackdrop` | `boolean` | `false` | 明確選擇才允許背景關閉 |
| `layer` | `'base' \| 'blocking'` | `'base'` | `z-50`／`z-[60]` |
| `lockBody` | `boolean` | `true` | 統一鎖定頁面捲動 |
| `labelledBy` | `string` | `undefined` | 對應 header 標題 id |
| `ariaLabel` | `string` | `'對話框'` | 無標題 id 時備援 |
| `headerClassName` | `string` | `''` | Wealth 等主題背景 |
| `contentClassName` | `string` | `''` | 內容版面，不用來覆寫高度 |
| `footerClassName` | `string` | `''` | 動作列排版 |

可直接落地骨架，共 48 行：

```jsx
import { useEffect } from 'react'
import { X } from 'lucide-react'

const WIDTH = { S: 'max-w-lg', M: 'max-w-3xl', L: 'max-w-5xl' }
const HEIGHT = {
  fixed: 'h-[85dvh] max-h-[48rem]',
  auto: 'h-auto max-h-[calc(100dvh-2rem)]',
}
const LAYER = { base: 'z-50', blocking: 'z-[60]' }
const SCROLL = {
  shell: 'overflow-y-auto',
  caller: 'overflow-hidden',
}

export default function ModalShell({
  size = 'M', height = 'fixed', scroll = 'shell',
  header, headerActions = null, footer = null, children,
  accent = null, onClose, showClose = true,
  closeDisabled = false, closeOnBackdrop = false,
  layer = 'base', lockBody = true, labelledBy,
  ariaLabel = '對話框', headerClassName = '',
  contentClassName = '', footerClassName = '',
}) {
  useEffect(() => {
    if (!lockBody) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [lockBody])

  return (
    <div className={`fixed inset-0 ${LAYER[layer]} flex items-center justify-center p-4`}>
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onMouseDown={closeOnBackdrop && !closeDisabled ? onClose : undefined}
        aria-hidden="true"
      />
      <section
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        className={`relative flex w-full flex-col overflow-hidden rounded-3xl
          bg-[#fdfbf7] shadow-2xl ${WIDTH[size]} ${HEIGHT[height]}`}
      >
        {accent && <div className="shrink-0">{accent}</div>}
        <header className={`shrink-0 flex items-center justify-between p-6 ${headerClassName}`}>
          {header}
          <div className="flex items-center gap-2">
            {headerActions}
            {showClose && onClose && (
              <button onClick={onClose} disabled={closeDisabled} aria-label="關閉">
                <X size={24} />
              </button>
            )}
          </div>
        </header>
        <div className={`flex-1 min-h-0 ${SCROLL[scroll]} ${contentClassName}`}>
          {children}
        </div>
        {footer && (
          <footer className={`shrink-0 border-t border-[#E8E8E8] p-4 ${footerClassName}`}>
            {footer}
          </footer>
        )}
      </section>
    </div>
  )
}
```

不適合主 Shell 的次級視窗應抽一個獨立 `CompactDialog`，供 Comment 密碼閘門、商店購買確認、護照交易修正／核銷共用；Gadgets 的「時間到」可用語意更窄的 `AlertOverlay`。不要加入 `ModalShell variant="compact"`，否則 Shell 會同時承擔主工作區、巢狀遮罩及提示框三種不同定位與高度語意。

另須在遷移時刪除五個彈窗既有的 body-lock effect，否則會與 Shell 重複鎖定及還原：CreateClassModal.jsx:26、RestoreClassModal.jsx:20、GadgetsModal.jsx:71、HistoryModal.jsx:17、TeamManagementModal.jsx:9。

ORDER:

1. `HistoryModal` — LOW。與第 2 項同批；用來驗證 M 級 caller-managed 篩選列與清單捲動。
2. `WealthLeaderboardModal` — LOW。與第 1 項同批；驗證 S 級固定高度及 header/content/footer。
3. `SyncConflictModal` — MEDIUM，單獨改、單獨驗。驗證 `auto`、`z-[60]`、無關閉鈕及背景不可關閉。
4. `TaskOverviewModal` — MEDIUM。可與第 5 項同一開發批次，但須分開做長任務展開測試。
5. `GadgetsModal` — MEDIUM。須另外驗證計時結束遮罩仍覆蓋整個 Shell，而非只覆蓋內容區。
6. `SettingsModal` — HIGH，單獨改、單獨驗。驗證八分頁、各分頁長表單、固定 footer、1024px 分頁列。
7. `TeamManagementModal` — HIGH，單獨改、單獨驗。列表模式與 50/50 編輯模式都要測，尤其左右獨立捲動。
8. `AnnouncementModal` — HIGH，單獨改、單獨驗。測空清單、大量公告與 footer 固定。
9. `CreateClassModal` — HIGH，單獨改、單獨驗。測 768px 以下高度、錯誤訊息及條件式繼承預覽。
10. `RestoreClassModal` — HIGH，單獨改、單獨驗。雲端、空檔案、成功解析、覆蓋警告四種狀態都要測。
11. `CommentModal` — HIGH，單獨改、單獨驗。密碼錯誤／成功、API 面板展開、批次進度、學生面板展開均是獨立案例。
12. `OrangeCatStoreModal` — HIGH，單獨改、單獨驗。左右捲動、訊息列及購買確認遮罩不可互相影響。
13. `PassportModal` — HIGH，最後單獨改、單獨驗。三分頁、左右捲動、交易修正與道具核銷疊層全數通過後再做總回歸。

只有 `History + Wealth` 適合直接同批完成；`Task + Gadgets` 可同一開發批次但必須各自驗證。其餘 HIGH 項不應合併後才驗收。

FINDINGS:

- CRITICAL：無。
- HIGH：CommentModal 有兩個完全不同的 return 分支；若在共同 return 外直接套 Shell，密碼閘門會被錯誤套成 M 級固定高度。src/components/modals/CommentModal.jsx:295、src/components/modals/CommentModal.jsx:341
- HIGH：Comment 主畫面的 API 摺疊區及批次工具都位於 `shrink-0` header；固定高度後，展開 API 區會直接侵蝕學生清單空間，且學生清單缺 `min-h-0`。src/components/modals/CommentModal.jsx:345、src/components/modals/CommentModal.jsx:392、src/components/modals/CommentModal.jsx:437、src/components/modals/CommentModal.jsx:476
- HIGH：Create 與 Restore 都是 `overflow-hidden` 外框包住無獨立捲動的長內容；即使採自適應例外，只加 `max-h` 仍會在矮螢幕裁切。src/components/modals/CreateClassModal.jsx:81、src/components/modals/CreateClassModal.jsx:89、src/components/modals/CreateClassModal.jsx:101、src/components/modals/RestoreClassModal.jsx:128、src/components/modals/RestoreClassModal.jsx:134
- HIGH：Announcement 的 footer 與內容在同一塊，清單又使用自己的 45vh 上限；直接套固定 Shell 會產生錯誤剩餘高度或雙重捲軸。src/components/modals/AnnouncementModal.jsx:58、src/components/modals/AnnouncementModal.jsx:89、src/components/modals/AnnouncementModal.jsx:116
- HIGH：OrangeCatStore 的左右欄是兩個獨立捲動容器，確認遮罩則絕對定位於最外層面板；Shell 若預設替整個內容捲動，確認遮罩會跟著內容區而非覆蓋完整商店。src/components/modals/OrangeCatStoreModal.jsx:73、src/components/modals/OrangeCatStoreModal.jsx:75、src/components/modals/OrangeCatStoreModal.jsx:100、src/components/modals/OrangeCatStoreModal.jsx:164
- HIGH：Passport 同時有左欄、右欄內容捲動及兩個面板級絕對定位對話框；這是最不能用「把既有 JSX 全塞進 children」方式遷移的彈窗。src/components/modals/PassportModal.jsx:174、src/components/modals/PassportModal.jsx:176、src/components/modals/PassportModal.jsx:292、src/components/modals/PassportModal.jsx:310、src/components/modals/PassportModal.jsx:787、src/components/modals/PassportModal.jsx:857
- HIGH：Settings 與 Team 都已自行切分多層捲動責任，必須使用 `scroll="caller"`；若 Shell 再加單一內容捲動，固定 footer、分頁列及雙面板工作區都可能變成巢狀捲動。src/components/modals/SettingsModal.jsx:523、src/components/modals/SettingsModal.jsx:541、src/components/modals/SettingsModal.jsx:1408、src/components/modals/TeamManagementModal.jsx:276、src/components/modals/TeamManagementModal.jsx:318、src/components/modals/TeamManagementModal.jsx:378
- MEDIUM：TaskOverview 的 header、篩選列缺 `shrink-0`，清單缺 `min-h-0`；固定高度下有被 flex 壓縮及捲動失效的風險。src/components/modals/TaskOverviewModal.jsx:78、src/components/modals/TaskOverviewModal.jsx:94、src/components/modals/TaskOverviewModal.jsx:134
- MEDIUM：Gadgets 標題目前在可捲內容內，時間到遮罩則依賴面板是 `position: relative`；重構時必須同時保留這個定位上下文。src/components/modals/GadgetsModal.jsx:169、src/components/modals/GadgetsModal.jsx:175、src/components/modals/GadgetsModal.jsx:367；src/index.css:334
- MEDIUM：五個彈窗自行修改 `document.body.style.overflow`，其他八個沒有；改由 Shell 統一管理時必須刪除舊 effect，且 cleanup 應恢復原值而非固定寫空字串。src/components/modals/CreateClassModal.jsx:26、src/components/modals/RestoreClassModal.jsx:20、src/components/modals/GadgetsModal.jsx:71、src/components/modals/HistoryModal.jsx:17、src/components/modals/TeamManagementModal.jsx:9
- MEDIUM：現有 13 個彈窗都沒有 `role="dialog"`／`aria-modal`；應由 Shell 一次補齊，次級 `CompactDialog` 也須自行提供相同語意。
- MEDIUM：`CommentPanel` 已確認只是 CommentModal 的內層表單卡片，不應列入外框遷移。src/components/modals/CommentPanel.jsx:72、src/components/modals/CommentModal.jsx:523
- 驗證：`npm run build` 成功，Vite 轉換 2,089 個模組並於 2.29 秒完成；僅有既有的大 chunk 警告。`npm test -- --run` 成功，5 個測試檔、52 項測試全數通過。
