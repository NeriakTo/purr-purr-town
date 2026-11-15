# 1A：舊快照轉換與點數對帳（T-599）

本階段只用虛構班級，在記憶體中轉換與對帳。DDL 僅為草稿，沒有執行，也沒有連線資料庫、正式後端或外部網站。`convert`、`reconcile` 不讀寫檔案、不取執行當下時間、不連網路。權限、操作程序、觸發規則、正式切換與歷史裁決留給 1B／1D。

依據：題目指定的統一規劃 v1.0 第三節、第四節 1A，及前次黑喵審查 NEXT 第 2、3 項。倉庫 `docs/ai-workflow/00-task-spec.md` 是既有評語功能規劃；本次契約以題目與此文件為準，沒有修改舊文件或 `src/`。

## 呼叫與驗收門檻

```js
import { convert } from './convert.js'
import { reconcile } from './reconcile.js'
import { classA } from './__fixtures__/classes.js'
const result = convert(classA)
const audit = reconcile(classA, result)
// audit.differences 為 []：來源和轉換結果一致，不表示來源本身沒有問題。
// 正式匯入需要 differences=[] 且 errors=[]，另完成待確認事項。
```

輸入限可由 JSON 匯出表示的一班資料，形狀為 `{ classId, className, data: { classId, className, teacher, students, logs, settings, updatedAt } }`，不是後端同步封套，也不是多班清單。實際匯出位置：`src/components/modals/SettingsModal.jsx:271`。`updatedAt` 是**匯出當下**，不能用它裁決不同裝置哪份內容較新。

輸出為 `{ rows: { 表名: [...] }, errors: [{code,path,value}], report }`。錯誤包含來源 JSON Pointer 與原值；批次另保存同一份 `validation_errors`。`report` 包含來源 SHA-256、版本、各表筆數、錯誤數及 `rules_triggered: 0`。未知與孤立資料仍有來源快照；可拆出的列保留，無法建立的外鍵為 `null`，不建虛構學生、不靜默略過、不自動修復。

對帳的 `differences` 是 `{path,expected,actual}` 清單，另逐生輸出餘額、累計、交易數、更正邊、背包數、使用數、評語學期與期中／期末統計。`source_errors` 保留來源問題，`ready_for_import` 同時要求無差異與無來源錯誤。兩個假班刻意包含來源錯誤；「對帳無差異」只證明忠實搬移，不能宣稱可正式匯入。

## 資料表與完整欄位對照

以下 `raw.x` 是該表 JSONB 欄位內的原欄位 `x`，不是丟棄或待補寫欄位。每個實體一列；結構化索引與關聯另有欄位。每個設定鍵一列，不再只以一包班級 JSON 作查詢正本。草稿保留部分複合設定為 JSONB，下一階段可依明確查詢需求增加欄位，不能在拆欄位時刪掉原值。

所有表共同欄位為 `id, batch_id, class_id, legacy_id, source_path, raw`。`source_path` 是 RFC 6901 JSON Pointer（`~`、`/` 分別跳脫），可定位完整來源。缺值不能在 JS 輸出成 `undefined`，一律以 JSON null 表示；是否原本存在可由來源完整快照和 `submissions.present` 查回。寫入 JSONB 時必須序列化 JSON 值，JSON null 不等於 SQL NULL。

| 舊位置／完整欄位 | 新表欄位／保存方式 |
| --- | --- |
| 匯出最外層 `classId,className,data`，`data.classId,className,teacher,updatedAt` | `migration_sources.raw` 完整匯出；`classes.legacy_id,name,teacher`；`classes.raw` 完整 data，`raw.updatedAt` 不改；內外 classId 不同報錯 |
| 匯出不存在的班級 `year,alias,status,studentCount` | 不補造；它們屬另一份本機班級索引，匯出未帶入。須於 1D 另外取得並裁決 |
| `students[].id,uuid` | `students.legacy_id` 優先 id，再 uuid；兩個原值都留 `raw`；舊編號與新編號存 `legacy_ids` |
| `students[].name,number,group,avatar,inactive` | `students.name,seat_number,group_key,avatar,enrollment_status`；原值全在 `raw` |
| `students[].seatNumber,gender` | `students.raw.seatNumber,raw.gender`；`number` 不在時不擅自以別欄位覆蓋，保留兩值供後續決定。舊畫面相容使用座號後備見 `src/components/dashboard/VillagerCard.jsx:16`；新班 gender 見 `src/App.jsx:60` |
| `students[].bank.balance,totalEarned,transactions` | `accounts.balance,total_earned,total_earned_source,ledger_sum,earned_recomputed` 及 `accounts.raw`；交易逐筆拆出，不能只留帳戶數字 |
| `bank.transactions[].id,date,amount,reason,balance` | `transactions.legacy_id,occurred_at,amount,reason,balance_after`，原值在 `raw`；陣列順序由 source_path 保存 |
| `transactions[].voided,type,correctedTxId` | `transactions.voided,transaction_type,corrected_transaction_id`；原 correctedTxId 在 `raw`，未找到或重複不猜對象；`legacy_semantics=true` |
| 非標準歷史交易 `excludeFromTotal` | `transactions.raw.excludeFromTotal` 原樣保存；不是舊 helper 的篩選條件。未知其他欄位另外報 UNKNOWN_FIELD |
| `students[].inventory[].itemId,name,icon,purchasedAt` | `inventory_items` 每個陣列元素一列，`legacy_id=itemId,legacy_index`；`product_id` 只依舊商品編號；`raw` 保存四個欄位。`purchase_transaction_id=null,consumed=false` |
| `students[].taskExemptRules[]:{keyword,taskType}` | `exempt_rules` 每條一列，`student_id` 與 `raw.keyword,raw.taskType` |
| 舊 `taskExemptRules:{keywords[],taskTypes[]}` | `exempt_rules` 一列保存兩陣列，不做笛卡兒積改寫；舊執行規則的展開見 `src/utils/helpers.js:526` |
| `students[].comments[學期]` | `comments.semester` 使用原 key，絕不搬到目前學期；`student_id` 關聯學生 |
| 評語 `rawComment,polishedComment,motto,analysis,status,errorMessage,generatedAt,updatedAt,modelUsed` | `comments.raw` 同名九欄全部保留，包含觀察文字、生成狀態與模型來源 |
| 評語 `locked,lockedComment,lockedMotto` | `comments.raw` 三原值；`locked_comment=lockedComment ?? locked ?? false`，`locked_motto=lockedMotto ?? locked ?? false`。明確 false 不被舊 true 蓋掉；非布林報 INVALID_LOCK |
| `logs[].date,tasks,status` | `logs.raw` 完整紀錄；每個 task 拆 `tasks`，每個狀態拆 `submissions`；紀錄序號保留，不以日期去重 |
| `logs[].tasks[].id,title,type,createdAt,dueDate` | `tasks.legacy_id,title,task_type,published_on,due_on`；`raw` 五原值。缺日期欄位只沿用舊 log.date 後備（不產生新日期），無法辨識學期則 semester=null |
| `logs[].status[學生舊編號][任務舊編號]` | `submissions.student_id,legacy_student_id,task_id,status,present,raw`；`legacy_id` 保存任務舊編號，完整語意見狀態表 |
| `settings.currentSemester` | `settings_entries(key=currentSemester).raw` 原值；`classes.current_semester` 是固定日期推算的讀取值，與原值分開 |
| `settings.semesterPeriods.midterm/final.{start,end}` | `semesters.period_key` 與 `raw.start,raw.end`；這是**期中／期末統計區間**，不是作業或交易的學期外鍵；整體也保存到 settings_entries |
| `settings.taskTypes[]` | `settings_entries(key=taskTypes).raw` 原陣列；自訂任務類型不強制套預設清單 |
| `settings.groupAliases[小組編號]` | `groups.group_key,raw` 保存別名；學生 group 保留原值含 unassigned，不猜小組長 |
| `settings.announcements[].id,text,color,rotate` | `announcements.legacy_id,raw` 對應四欄 |
| `settings.jobs[].id,title,salary,icon,cycle,category` | `jobs.legacy_id,raw` 對應六欄；不以目前職務反推舊薪資交易 |
| `settings.jobAssignments[職務舊編號][]` | `job_assignments.job_id,student_id,raw` 每次指派一列；原 key 與陣列序號保存於 source_path，完整原映射也在 settings_entries |
| `settings.dutyJobId` | `settings_entries(key=dutyJobId).raw`；驗證職務存在，null 保留 |
| `settings.dailyDuty.{date,studentIds[],paid}` | `daily_duties.raw.date,raw.studentIds,raw.paid`；不模仿舊畫面開啟時跨日重設 paid，不補發薪 |
| `settings.behaviorRules[].id,label,amount,type,icon,category` | `rules.legacy_id,raw` 保存六欄；匯入不執行這些規則 |
| `settings.ruleCategories[].id,name,icon` | `settings_entries(key=ruleCategories).raw` 每個分類完整保留；驗證未知欄位 |
| `settings.automation.dailyQuestBonus,latePenalty,missingPenalty` | `settings_entries(key=automation).raw` 三原值，不觸發自動獎懲 |
| `settings.shop.name,icon,products` | `settings_entries(key=shop).raw` 商店中繼資料與原陣列；商品另拆 products |
| `shop.products[].id,name,icon,price,priceUnit,stock,initialStock,description` | `products.legacy_id,raw` 八原值，保留剩餘／初始庫存及商品價格幣別，不重設庫存，不依背包回推原量 |
| 舊 `settings.storeItems[]` | 同樣逐筆進 products，source_path 區分來源；與 shop 同時存在不靜默擇一。相同 id 報重複並隔離關聯 |
| `settings.currency.base.{name,icon}`，`tier1/tier2.{name,icon,rate}` | `settings_entries(key=currency).raw` 全部保存；不重新換算任何歷史點數 |
| 舊 `settings.currencyRates.{fish,cookie}` | `settings_entries(key=currencyRates).raw` 保存；不覆蓋 currency；舊讀取後備見 `src/utils/helpers.js:336` |
| `settings.seatingChart.rows,cols,perspective,grid,objects,customObjects` | `settings_entries(key=seatingChart).raw` 六原值；grid 每個座位拆 seats，objects 仍在 raw |
| `seatingChart.grid[座標]=學生編號` | `seats.coordinate,student_id,raw`；孤立學生報錯，保留原編號 |
| `seatingChart.objects[座標]=物件編號`，`customObjects[].id,label,icon,color` | `settings_entries(key=seatingChart).raw.objects,raw.customObjects`；自訂物件實作見 `src/components/seating/SeatingWaitingList.jsx:65`。相容 `name` 也保留，不取代 label |
| 以上所有未列出的欄位／額外子欄位 | UNKNOWN_FIELD 列原路徑、原值；來源 raw 與所屬實體 raw／設定 raw 保留，不做刪欄白名單清洗 |

`legacy_ids` 每列含 `table_name,target_id,legacy_id,source_path`，同一來源路徑可以對應不同表（例如 dailyDuty 設定與值日生列）；唯一鍵必須包含 table_name，不能只用 path。SQL 的共同 raw 允許物件、陣列、純量或 JSON null，不將不同型別字串化丟失。

## 狀態逐值對照與歷史指派

來源依據：`src/utils/helpers.js:174`、`src/utils/helpers.js:182`。

| 舊值 | 新 status | present | 語意 |
| --- | --- | --- | --- |
| true | on_time | true | 舊布林完成＝準時 |
| 'on_time' | on_time | true | 準時 |
| 'late' | late | true | 遲交 |
| 'missing' | missing | true | 明確缺交 |
| 'leave' | leave | true | 請假 |
| 'exempt' | exempt | true | 免交 |
| 'makeup' | makeup | true | 補交，保留原扣分，**不回沖** |
| false | pending | true | 待收；不是已確認缺交 |
| 缺鍵 | pending | false | 未記錄；不是已確認缺交 |
| 未知值（含 null、數字、物件、其他字串） | unknown | true | UNKNOWN_STATUS；原值保留 raw |

只有在該歷史 log 的 `status` 已有某學生容器時，才對該 log 有舊編號的 tasks 展開缺鍵；這表示「有此歷史容器」，不是證明該學生當時被指派。不存在的學生容器與不存在的任務 key 也輸出列並報錯。沒有學生容器就不拿現在全班學生補應交列。

舊格式沒有獨立的「當時指派名單」；`tasks.assignees_known=false` 且逐任務列 UNKNOWN_ASSIGNMENT_LIST。現有狀態容器只記 `assignment_evidence=legacy_status_container`，不能宣稱已還原完整名單。之後新作業必須保存當時名單；歷史待裁決前保持未知。

舊「訂正」任務保留原 task 與 status，`correction_state=legacy_unlinked, original_task_id=null, teacher_confirmed=null`。不猜原作業，不把舊完成值推定成新版老師確認，也不建立虛構訂正輪次。其他 task 的 correction_state 為 null。

## 點數與更正契約

餘額、已保存累計、交易重算累計是三件事，不能互相覆蓋。

1. `accounts.balance` 保存來源 bank.balance；沒有 bank／balance 時用舊畫面相容的零讀值，原欄位是否存在仍可查 raw。`ledger_sum` 對**所有**交易 amount 加總，包含 voided 的原交易與所有差額交易；它只供驗算。只要不相等列 BALANCE_DRIFT，沒有期初差額交易，不自動歸零。每筆已保存 balance 與從零起算的前綴不一致時列 TRANSACTION_BALANCE_DRIFT，可能代表歷史截斷或既有錯誤，交主控裁決。
2. 舊更正見 `src/views/DashboardView.jsx:499`：原交易標 voided，新增 amount=新金額−原金額，餘額加此差額。例 +100、−20、+5 的鏈合計 +85，不能排除前兩筆後只剩 +5。保留原金流與差額鏈，**不轉寫成反向沖銷**。更正差額本身又被改時仍指向該差額交易，不把它誤當根交易的新絕對金額。
3. 每筆更正的舊 correctedTxId 只在同一學生的交易中解析。找不到、重複、缺原編號或循環都報錯，無法可靠解析的外鍵為 null；兩份同名商品或相同理由不作關聯依據。
4. `accounts.total_earned` 若來源有 totalEarned 就**原樣保留**；缺欄位才照舊 helper 重算，來源分別標 `legacy_stored`／`legacy_recomputed`。依據 `src/utils/helpers.js:463`。非數值不硬轉數字，輸出 typed null、保留 raw 並報錯。
5. 舊增量更新為 `options.excludeFromTotal ? 0 : amount`（`src/utils/helpers.js:478`）。商店購買及道具使用傳入此選項，交易本身**沒有保存此選項**（`src/views/DashboardView.jsx:586`、`src/views/DashboardView.jsx:618`）。更正時依原交易理由前綴「購買」「使用道具」決定累計是否變動（`src/views/DashboardView.jsx:507`）。不能宣稱只從歷史交易可還原當初所有 excludeFromTotal 決定。
6. `earned_recomputed` 照 `src/utils/helpers.js:435`：先篩日期區間，再以區間內交易建立舊 ID 對照，排除 voided、理由以「購買」「使用道具」開頭，以及 correction 原交易在對照內且屬商店消費的差額，其餘加 amount。`excludeFromTotal` 即使出現在非標準歷史 tx，也不是此 helper 的篩選條件。已保存 totalEarned 與它不等時列 TOTAL_EARNED_DRIFT，兩值都保留。這是舊版增量／重算語意差異，不是轉換器可以私自修正的數字。
7. 期中／期末統計使用來源 start/end 與臺灣本地日期，無界限沿用舊 helper 的全區間行為。原商店交易在區間外、更正在區間內時，舊 helper 查不到原交易，可能把差額計入；本次忠實保留此行為並測試，不順便修正舊統計。

所有金額以原基底積分保存；不以現行幣值重新換算。非法金額保留原字串等 raw 值，typed amount=null，相關重算為 null 並報 INVALID_AMOUNT，不能當成合法零。交易筆數、更正邊、原 voided 與每筆內容逐項核對，不只比最後餘額。

## 商店、背包、核銷

每個現存 inventory 陣列元素都建立獨立 `inventory_items.id`，即使 itemId、名稱、購買時間完全相同，也由來源陣列序號分開。這個序號只對該份來源有效，不能拿不同日期的陣列索引合併物品。

舊購買沒有交易 ID（`src/views/DashboardView.jsx:587`），核銷用 itemIndex 刪掉陣列元素，只另記一筆金額零的「使用道具」交易（`src/views/DashboardView.jsx:610`）。因此現存物品 `consumed=false`，`purchase_transaction_id=null`；歷史已核銷物品無法還原個別 ID，**不建假的已核銷物品列，也不靠名稱猜購買／核銷配對**。對帳逐件比現存 raw、件數、序號與所有使用交易，已使用次數可查，使用哪件保持未知。

商品的剩餘庫存、initialStock、價格與幣別完整保存；來源無購買關聯時，不用交易文字重建庫存，也不把初始庫存減背包數當成真值。

## 學期、在學狀態與重跑

`currentSemester` 為空時，依來源 `data.updatedAt` 的臺灣日期套舊版月份公式（`src/utils/helpers.js:552`）：8–12 月為當年民國學年第 1 學期；1 月為前學年第 1 學期；2–7 月為前學年第 2 學期。這只是固定的「來源匯出日期讀取值」，不是所有歷史資料的學期。來源沒有可用日期就保持 null 並報錯；不取現在時間。已指定但格式未知也報錯。

評語永遠用原 key。作業與交易沒有學期欄位或明確邊界裁決，全部 semester=null，逐筆列 UNKNOWN_TASK_SEMESTER／UNKNOWN_TRANSACTION_SEMESTER；保留日期，不能歸到目前學期，也不拿期中／期末區間當學期。

`inactive=true` 只轉 `home_study`（在家自學）；false／缺欄位為 enrolled。另保留 transferred、archived 兩種新狀態於 DDL，但舊匯出沒有可驗證資料時不產生。依據 `src/utils/helpers.js:187`、`src/utils/constants.js:164`。不把缺席、自學、刪除學生混為轉出或封存。

班級 ID 是 SHA-256(['class',來源班級編號])；其餘 ID 是 SHA-256([來源班級編號,表名,來源 path,舊編號])。無舊編號的 log、背包等用來源 path 作穩定定位，並報告需要舊 ID 的實體缺漏。批次 ID 由版本＋班級編號＋完整來源內容雜湊推導，不使用時間或亂數。**同一份來源**重跑列與 ID 完全一致；重新排序／內容變更是另一份來源，不能用此工具自行合併或裁決裝置快照。

SQL 草稿以 ID 主鍵與批次／來源路徑唯一約束擋重複，legacy_ids 的 path 唯一約束另含表名。1B 必須將同 ID 同內容視為已處理，同 ID 異內容視為衝突，不能無條件 UPDATE。本次沒有實作資料庫寫入，不宣稱已驗證資料庫的重送、並行或權限。

## 匯入邊界、未知值與待確認

`import_rules_enabled=false`、每筆交易 `legacy_semantics=true`，純函式完全不呼叫點數規則，不因 pending／missing／makeup 自動補帳。新規則僅從正式切換後生效；1B 的專用匯入路徑必須落實不觸發獎懲，不能僅靠這個布林欄位當安全措施。

錯誤分類包含 UNKNOWN_FIELD／STATUS／學期／名單，INVALID_*、MISSING_LEGACY_ID、DUPLICATE_LEGACY_ID、AMBIGUOUS_REFERENCE、ORPHAN_STUDENT／TASK／PRODUCT／JOB／CORRECTION、CORRECTION_CYCLE，以及餘額／累計／交易前綴差異。任何錯誤都使 ready_for_import=false；不把保留 raw 當成問題已解決。保留整包來源是最後的內容保全層，但對帳仍逐表驗證列數、原始內容、關聯與金額，不能只比整包副本。

待確認清單（均未替老師或主控作資料裁決）：

1. **歷史點數差異：** 商店購買第一次更正的理由是「修正：購買…」，第二次更正差額會加入累計，因為舊版流程只檢查被更正那筆理由的前綴（DashboardView.jsx:496–517）；轉換保留此行為。多跳回歸案例的逐步 totalEarned 與 helper 都是 105。  已保存 totalEarned 與舊 helper 重算不同時，正式新畫面要沿用哪個定義？本次並存、報錯，沒有更動來源。若餘額與全交易和不符，是否缺歷史、需要何種有依據的期初帳？必須有明確確認紀錄才能新增。
2. **作業／交易學期：** 請提供學期邊界與歸屬裁決；不從目前學期或匯出日猜填。期中／期末區間不能替代學期邊界。
3. **空 currentSemester 的基準日期：** 試轉以來源匯出日固定推算；正式切換若要用老師指定切換日，應明確傳入並版本化，不能依執行當下日期偷偷改結果。
4. **歷史當時名單與舊訂正：** 如何取得原指派名單？舊訂正若要連原作業及老師確認，必須另有可核對資料或人工確認；沒有時維持未知／未連結。
5. **已核銷物品：** 接受只能保存使用紀錄、無法建立已刪物品的個別購買／核銷鏈嗎？舊格式無法提供的資訊不可由本工具補造。
6. **異常來源：** 未知欄位、狀態、重複編號、孤立關聯、雙商品來源衝突與非法資料由誰裁決？本次保留全值、隔離外鍵、阻擋匯入；不得用「對帳無差異」略過。
7. **匯出未帶入的班級索引：** year／alias／status 等須在 1D 收齊來源，轉出／封存身分也不能從 inactive 推斷。number 與 seatNumber 衝突時須裁決，現階段兩值均保留。

做了哪些假設：JSON 匯出是本題的來源單位，不是所有本機儲存的聯集；時區依題目採 Asia/Taipei；既有交易已反映獎懲，不重新執行。無法從舊格式證明的關係全部保留未知並列錯誤，而非選一種資料解讀補填。

## 驗證與前次審查對照

測試先於實作：初版 21 項中 19 項失敗、2 項僅重跑空結果的測試通過；實作後再增加舊 helper 交叉核對與破壞測試。執行根目錄 `npx vitest run`；新增檔案執行 `npx eslint server/migration`。DDL 僅靜態檢查輸出欄位與唯一鍵，**沒有在 PostgreSQL 執行**，真正約束與交易測試屬 1B。

| 前次審查問題 | 本次驗收證據 |
| --- | --- |
| NEXT 2：逐值狀態、訂正、編號、學期、未知值 | convert.test.js 狀態矩陣、重跑、不改來源、雙鎖、自學、孤立與循環；reconcile.test.js 日期邊界、無名單不回推、非法來源保全 |
| NEXT 3：餘額／累計分開、更正鏈、商店背包 | 含 voided 的金流和、快取與重算並存、商店跨區間與實際舊 helper 相等、同商品多件及使用交易保存 |
| CRITICAL 不遺失／不自動調整 | 完整來源快照＋逐實體 raw；逐表缺列／重複／改壞內容會出差異；餘額不平只報錯不加交易 |
| HIGH 可重跑 | 同來源兩次深度相等、列 ID 唯一、舊編號對照、DDL 主鍵／來源唯一鍵草稿 |

測試資料 `__fixtures__/classes.js` 僅含「測試甲／乙／丙」與假班、假老師；沒有讀任何真實學生資料。全程未連網路，未讀 `.env*`、憑證或正式資料。

## R2 寫入欄位掃描（2026-11-15）

方法：對整個 `src/` 執行 `rg -n` 搜尋 `setStudents|setLogs|setAllLogs|setSettings|setLocalSettings|onUpdateStudent|onUpdateSettings|updateSettings|updateProduct|saveClassCache|createTransaction`，再追蹤各 callback 的建立物件、動態 `[field]` 與彈窗 onChange；以預設常數及初始化 helper 交叉核對。

實讀：`src/App.jsx`、`src/views/DashboardView.jsx`、`src/views/SeatingView.jsx`、`src/utils/constants.js`、`src/utils/helpers.js`、`src/utils/classInherit.js`、`src/utils/storage.js` 的寫入包裝，以及 `src/components/dashboard/TaskBoard.jsx`、`src/components/modals/SettingsModal.jsx`、`settings/JobSettingsTab.jsx`、`settings/SyncSettingsTab.jsx`、`PassportModal.jsx`、`CommentModal.jsx`、`CommentPanel.jsx`、`AnnouncementModal.jsx`、`TeamManagementModal.jsx`、`src/components/seating/SeatingWaitingList.jsx`。

結果：新增 `shop.products[].description` 與相容 `storeItems[].description`（SettingsModal.jsx:433–444、1163）；完整保存在 products.raw。學生、bank/交易、背包、免交規則、評語、log/task/status、職務與指派、值日生、公告、貨幣、自動化、座位及自訂物件的其餘寫入欄位均已在上方清冊，未發現其他漏列。班級索引 alias/year/status/studentCount 與獨立 localStorage 的密碼、API key、同步設定不屬班級 JSON 匯出，不納入允許欄位；僅閱讀程式碼，未讀取任何設定值或憑證。還原與同步保留任意來源欄位，不代表它們是 UI 定義的已知欄位，仍逐筆報 UNKNOWN_FIELD。

R4：重複交易編號的累計重算仍取最後一筆，與舊 helper 的 Object.fromEntries 相同；AMBIGUOUS_REFERENCE 會列錯誤且更正外鍵為 null，阻擋匯入。重算數字用於比對舊版，不能把外鍵隔離解讀成修正歷史統計。
