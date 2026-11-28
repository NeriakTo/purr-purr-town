# 1A：舊快照轉換與點數對帳（T-599／T-602）

本階段只用虛構班級，在記憶體中轉換與對帳。DDL 僅為草稿，沒有執行，也沒有連線資料庫、正式後端或外部網站。`convert`、`reconcile` 不讀寫檔案、不取執行當下時間、不連網路。權限、操作程序、觸發規則、正式切換與歷史裁決留給 1B／1D。

本輪依據「改版操作規格 v0.4 第 7.4 節」及「統一改版規劃」第 5.2 節第 8～11 列。

## 呼叫與驗收門檻

```js
import { convert } from './convert.js'
import { reconcile, legacyEarned } from './reconcile.js'
import { validateSource } from './source-validation.js'
import { classA } from './__fixtures__/classes.js'

const decisions = {
  cutoverDate: '2026-11-15',
  openingAdjustment: true,
  semesterRule: 'month',
}
const notices = []
const openingAdjustments = []
const sourceErrors = validateSource(classA, legacyEarned, { decisions, notices, openingAdjustments })
const converted = convert(classA, { decisions })
const audit = reconcile(classA, converted, { decisions })
```

正式匯入前，呼叫端須明傳三項決定。對帳以批次保存的 `decisions` 重算，呼叫端可另外傳入預期決定，任何不符都列入 `differences`。

| 決定 | 指定值 | 省略時 |
| --- | --- | --- |
| `cutoverDate` | 臺灣日期 `YYYY-MM-DD` | 批次 `cutover_date=null`，不產生期初調整。來源未設定目前學期時，改用 `data.updatedAt` 推算 |
| `openingAdjustment` | `true`，須同時提供 `cutoverDate` | 停用期初調整，`BALANCE_DRIFT`、`TOTAL_EARNED_DRIFT` 擋匯入 |
| `semesterRule` | `'month'` | 作業與交易的 `semester` 留空，各自列 `UNKNOWN_TASK_SEMESTER` 或 `UNKNOWN_TRANSACTION_SEMESTER` 擋匯入 |
| `orphanTaskStatus`（選填） | `'snapshot_only'` | 找不到當天作業的狀態照常建立繳交列，並列 `ORPHAN_TASK` 擋匯入 |

`openingAdjustment: true` 缺切換日會直接拋出輸入錯誤。非法切換日列 `INVALID_CUTOVER_DATE`。明傳的 `orphanTaskStatus` 只接受 `'snapshot_only'`。批次以 `decisions` JSONB 原樣保存決定，預設空物件。`cutover_date` 保存明傳的日期文字，`converter_version` 是 `v2-1A-r5`。

輸入限可由 JSON 匯出表示的一班資料，形狀為 `{ classId, className, data: { classId, className, teacher, students, logs, settings, updatedAt } }`，不是後端同步封套，也不是多班清單。實際匯出位置：`src/components/modals/SettingsModal.jsx:271`。`updatedAt` 是**匯出當下**，不能用它裁決不同裝置哪份內容較新。

輸出為 `{ rows: { 表名: [...] }, errors: [{code,path,value}], report }`。錯誤包含來源 JSON Pointer 與原值；批次另保存同一份 `validation_errors`。`report` 包含來源 SHA-256、版本、各表筆數、錯誤數及 `rules_triggered: 0`。未知與孤立資料仍有來源快照；可拆出的列保留，無法建立的外鍵為 `null`，不建虛構學生、不靜默略過、不自動修復。依主控 2026-11-24 裁定，啟用 `orphanTaskStatus: 'snapshot_only'` 後，已刪作業的狀態留在 `logs.raw` 與 `migration_sources.raw`，逐筆列提示。

對帳的 `differences` 是 `{path,expected,actual}` 清單，另逐生輸出餘額、累計、交易數、更正邊、背包數、使用數、評語學期與新舊期間統計。`source_errors` 保留來源問題，`ready_for_import` 要求三項決定齊全、無差異且無來源錯誤。兩個假班刻意包含來源錯誤；「對帳無差異」只證明忠實搬移，不能宣稱可正式匯入。

## 試轉摘要

在倉庫根目錄執行，明傳 `--decisions` JSON。命令只讀指定來源檔，將摘要 JSON 印到標準輸出。參數、讀檔、解析或決定錯誤會回傳結束碼 2，原因印到標準錯誤。

```sh
node server/migration/trial-summary.js server/migration/__fixtures__/trial-source.json --decisions '{"cutoverDate":"2026-11-15","openingAdjustment":true,"semesterRule":"month","orphanTaskStatus":"snapshot_only"}'
```

程式內可匯入純函式 `summarizeTrial(source, decisions)`。

| 輸出鍵 | 內容 |
| --- | --- |
| `converter_version`、`batch_id`、`decisions`、`row_counts` | 轉換器版本、批次編號、表中已知的決定及各表筆數 |
| `legacy_effect_counts` | `by_link_state`、`by_unresolved_reason` 只列實際出現的狀態與原因筆數；沒有資料時為空物件 |
| `error_counts`、`notice_counts` | 各錯誤碼與提示碼的筆數 |
| `orphan_task_statuses` | 依 `day`、`task_key` 排序列出各組的 `count`、`by_status`。缺少日期或日期值不是字串時，摘要的 `day` 為 `null` |
| `duplicate_seat_numbers` | 重複的 `seat_number` 與 `student_paths`。只統計非空的 `number`，轉為字串後去除前後空白再比對 |
| `seat_number_coverage` | 有 `number` 的 `with_number`、只有 `seatNumber` 的 `seat_number_only`、兩欄皆空的 `neither` |
| `opening_adjustments` | 每筆調整的 `path`、`amount`、`earned_delta` |
| `convert_ready` | 轉換結果的匯入就緒狀態 |
| `reconcile` | `matches`、`difference_count`、`difference_paths`（最多前 50 筆路徑）、`period_skipped_count`、`ready_for_import` |

## 歷史效果

每筆來源明列（`present: true`）且可解析學生與作業的 `late`、`missing` 或 `makeup` 繳交產生一列 `legacy_effects`。共同欄位沿用繳交的 `source_path`，`legacy_id` 留空。三個外鍵為 `submission_id`、`student_id`、`task_id`。

`raw` 記錄該生的三種筆數。以下兩種扣分理由均須完整相符。

| 鍵 | 計數依據 |
| --- | --- |
| `candidate_transactions` | 有效金額小於零且理由為「作業遲交」或「作業缺交」的 `legacy_general` 根交易。有效金額為原金額加上可解析的更正差額，撤銷後為零的交易排除 |
| `refund_transactions` | 理由為「更正：撤銷遲交扣分」或「更正：撤銷缺交扣分」的所有交易 |
| `possible_submissions` | 來源明列的遲交、缺交及補交，含無法解析作業的狀態 |

判定依下表由上而下，第一項不成立即記為 `unresolved_reason`。遲交與缺交各看自己的事件。補交合併兩種事件，並從唯一候選的理由決定事件。日期沿用轉換器的臺灣日期解析，發布日取 `task.createdAt ?? log.date`。

| 順序 | 原因 | 何時記入 |
| --- | --- | --- |
| 1 | `orphan_status` | 同一學生有遲交、缺交或補交指向全部紀錄中都找不到的作業。2026-11-24 裁定適用於該生所有歷史效果，無論是否傳入 `orphanTaskStatus`。舊版刪作業未退分，殘留扣分可能被誤配 |
| 2 | `has_makeup` | 判定遲交或缺交時，同一學生另有補交 |
| 3 | `multiple_submissions` | 遲交或缺交有多筆同狀態繳交，或補交以外還有可能帶扣分的繳交 |
| 4 | `no_candidate` | 適用事件沒有候選扣分 |
| 5 | `multiple_candidates` | 適用事件有多筆候選扣分 |
| 6 | `has_refund` | 適用事件已有退分 |
| 7 | `amount_mismatch` | 候選原始金額不等於來源現行自動扣分，或金額為零 |
| 8 | `date_unknown` | 交易或作業發布日無法解析 |
| 9 | `date_before_task` | 交易的臺灣日期早於作業發布日 |
| 10 | `same_name_rule` | 來源手動規則的 `label` 與交易理由完全相同，且金額等於候選原始金額 |

條件全數成立時，`link_state` 為 `candidate`，`event` 為 `submission.late` 或 `submission.missing`，`transaction_id` 指向唯一候選，`amount_at_link` 保存其有效金額，`unresolved_reason` 留空。其餘列為 `unresolved`，事件、交易編號與有效金額留空。候選留待匯入前裁決。

`report.legacy_effects` 逐列提供 `submission_id`、`link_state`、`unresolved_reason`、學生座號 `seat_number`、作業標題 `task_title`、臺灣發布日 `task_published_on`。每列的 `candidate_transactions` 包含適用事件的候選交易編號、臺灣日期、原始金額及理由。`same_name_rule_amounts` 依適用的扣分理由列出同名手動規則的金額陣列，無同名規則時填「無」。日期無法解析時為 `null`。

`report.excess_legacy_deductions` 逐生列出有效舊扣分交易多於可能帶扣分繳交的情況，保留 `student_id`、`seat_number` 和兩種筆數。

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
| `students[].bank.balance,totalEarned,transactions` | `accounts.balance,total_earned,total_earned_source,ledger_sum,legacy_earned_recomputed,earned_delta_sum` 及 `accounts.raw`；交易逐筆拆出，不能只留帳戶數字 |
| `bank.transactions[].id,date,amount,reason,balance` | `transactions.legacy_id,occurred_at,amount,reason,balance_after`，原值在 `raw`；陣列順序由 source_path 保存 |
| `transactions[].voided,type,correctedTxId` | `transactions.voided,transaction_type,corrected_transaction_id`；原 correctedTxId 在 `raw`，未找到或重複不猜對象；`legacy_semantics=true` |
| 非標準歷史交易 `excludeFromTotal` | `transactions.raw.excludeFromTotal` 原樣保存；不是舊 helper 的篩選條件。未知其他欄位另外報 UNKNOWN_FIELD |
| `students[].inventory[].itemId,name,icon,purchasedAt` | `inventory_items` 每個陣列元素一列，`legacy_id=itemId,legacy_index`；`product_id` 只依舊商品編號；`raw` 保存四個欄位。`purchase_transaction_id=null,consumed=false` |
| `students[].taskExemptRules[]:{keyword,taskType}` | `exempt_rules` 每條一列，`student_id` 與 `raw.keyword,raw.taskType` |
| 舊 `taskExemptRules:{keywords[],taskTypes[]}` | `exempt_rules` 一列保存兩陣列，不做笛卡兒積改寫；舊執行規則的展開見 `src/utils/helpers.js:526` |
| `students[].comments[學期]` | `comments.semester` 使用原 key，絕不搬到目前學期；`student_id` 關聯學生 |
| 評語 `rawComment,polishedComment,motto,analysis,status,errorMessage,generatedAt,updatedAt,modelUsed` | `comments.raw` 同名九欄全部保留，包含觀察文字、生成狀態與模型來源 |
| 評語 `locked,lockedComment,lockedMotto` | `comments.raw` 三原值；`locked_comment=lockedComment ?? locked ?? false`，`locked_motto=lockedMotto ?? locked ?? false`。明確 false 不被舊 true 蓋掉；非布林報 INVALID_LOCK |
| `logs[].date,tasks,status` | `logs.raw` 完整紀錄；每個 task 拆 `tasks`，狀態依下節規則拆 `submissions`；紀錄序號保留，不以日期去重 |
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

只有在該歷史 log 的 `status` 已有某學生容器時，才對該 log 有舊編號的 tasks 展開缺鍵；這表示「有此歷史容器」，不是證明該學生當時被指派。找不到學生或當天作業時，預設仍建立繳交列並報錯。沒有學生容器就不拿現在全班學生補應交列。

明傳 `orphanTaskStatus: 'snapshot_only'` 時，若全部日期的 `tasks` 都找不到該鍵，視為作業已刪除。該狀態保留在 `logs.raw` 與 `migration_sources.raw`，逐筆列 `ORPHAN_TASK_STATUS` 提示，省略繳交列與舊編號對照。僅在別天找得到同一作業鍵時，仍建立繳交列，當天的作業外鍵留空並列 `ORPHAN_TASK`。找不到學生時仍列 `ORPHAN_STUDENT`。

舊格式沒有獨立的「當時指派名單」；`tasks.assignees_known=false` 且逐任務在 `report.notices` 列帶來源路徑的 `UNKNOWN_ASSIGNMENT_LIST`。現有狀態容器只記 `assignment_evidence=legacy_status_container`，不能宣稱已還原完整名單。之後新作業必須保存當時名單；歷史待裁決前保持未知。

舊「訂正」任務保留原 task 與 status，`correction_state=legacy_unlinked, original_task_id=null, teacher_confirmed=null`。不猜原作業，不把舊完成值推定成新版老師確認，也不建立虛構訂正輪次。其他 task 的 correction_state 為 null。

## 交易與帳戶

| 欄位 | 轉換規則 |
| --- | --- |
| `kind` | 根交易按理由前綴辨識 `shop_purchase`、`item_use`，其餘為 `legacy_general`。可沿前一筆更正走到根的列為 `correction`，斷鏈和經過斷鏈的更正為 `legacy_orphan_correction` |
| `root_transaction_id` | 更正直接指向同一學生的根，其餘留空。`corrected_transaction_id` 保存原來指向前一筆的關係，無可靠對象或位於循環時留空 |
| `chain_broken` | 孤立更正及其後代為 `true`，其餘為 `false` |
| `earned_delta` | 一般根交易及其更正等於 `amount`，購買、道具使用及其更正為 0。孤立更正先移除開頭連續的「撤銷：」「修正：」，以「購買」或「使用道具」開頭為 0，其餘等於 `amount`。非法金額留空 |
| `effective_at` | 更正取根交易日期，其餘舊交易取自身日期。交易自身日期無法解析時留空並列 `INVALID_TRANSACTION_DATE`；根日期無法解析時，其更正的歸屬日期也留空 |
| `semester` | 指定月份規則後由 `effective_at` 的臺灣日期推算，更正跟著根。歸屬日期空值時留空 |
| `origin`、`op_id` | 轉換列固定 `migration`、空值。DDL 要求轉換批次存在。操作來源須有操作編號 |

`transaction_type` 保存舊型別，`voided` 保存舊標記。新版金額與累計加總納入已作廢交易的原金額和更正差額。舊撤銷與改金額同屬更正類型，轉換保留其差額鏈。來源中的非標準 `excludeFromTotal` 存在 `raw`；新版累計直接使用 `earned_delta`。

`accounts.balance` 保存舊餘額，缺值沿用 0。`ledger_sum` 為全數舊交易金額合計。`total_earned` 保存舊累計，缺值才以舊算法重算，來源分別記 `legacy_stored`、`legacy_recomputed`。`legacy_earned_recomputed` 供核對舊畫面，`earned_delta_sum` 是舊交易按新定義的累計合計。這兩個重算欄位都排除期初調整。非法金額保留原值並報錯，typed 欄位留空。

舊 helper（`src/utils/helpers.js:435`）先依日期篩選，再從該期間內找更正對象，排除已作廢交易、商店消費與可辨認的首層商店更正。商店購買第二次更正差額會加入累計，是舊統計可能出現的行為。`legacy_earned_recomputed` 保留這個結果，新版沿完整更正鏈辨識商店根。

### 期初調整

指定 `openingAdjustment: true` 與有效切換日後，每位學生將 `balance - ledger_sum` 放進 `amount`，將 `total_earned - earned_delta_sum` 放進 `earned_delta`。兩差額皆零時省略該列。

調整列的 `kind` 是 `migration_opening_adjustment`，`transaction_type` 是 `opening_adjustment`，理由是「轉換期初調整」。`occurred_at` 為切換日臺灣零時（例如 `2026-11-15T00:00:00+08:00`）。`effective_at`、`semester`、兩個更正關聯、`balance_after` 與 `legacy_id` 皆空。`legacy_semantics` 為 `true`，`voided`、`chain_broken` 為 `false`。

`source_path` 使用該生帳戶的 `/bank` 路徑。`raw` 保存 `balance`、`ledger_sum`、`total_earned`、`earned_delta_sum` 四個算式輸入。`report.opening_adjustments` 逐列保存 `path`、`amount`、`earned_delta` 與 `reason`。期初調整參與餘額及累計對帳，期間統計因其歸屬日為空而排除該列。

## 商店、背包、核銷

每個現存 inventory 陣列元素都建立獨立 `inventory_items.id`，即使 itemId、名稱、購買時間完全相同，也由來源陣列序號分開。這個序號只對該份來源有效，不能拿不同日期的陣列索引合併物品。

舊購買沒有交易 ID（`src/views/DashboardView.jsx:587`），核銷用 itemIndex 刪掉陣列元素，只另記一筆金額零的「使用道具」交易（`src/views/DashboardView.jsx:610`）。因此現存物品 `consumed=false`，`purchase_transaction_id=null`；歷史已核銷物品無法還原個別 ID，**不建假的已核銷物品列，也不靠名稱猜購買／核銷配對**。對帳逐件比現存 raw、件數、序號與所有使用交易，已使用次數可查，使用哪件保持未知。

商品的剩餘庫存、initialStock、價格與幣別完整保存；來源無購買關聯時，不用交易文字重建庫存，也不把初始庫存減背包數當成真值。

## 學期、在學狀態與重跑

來源 `currentSemester` 空值時用切換日推算，未傳切換日才用匯出日。匯出日推不出目前學期時列 `UNKNOWN_CURRENT_SEMESTER`。來源有合法學期就保留原值，格式不合法列 `INVALID_CURRENT_SEMESTER`。

月份規則沿用 `src/utils/helpers.js:553`。8～12 月為當年民國學年第 1 學期，1 月為前學年第 1 學期，2～7 月為前學年第 2 學期。作業使用 `createdAt`，缺值時才取 `log.date`。無時區的 ISO 日期時間以臺灣時間解讀。評語沿用原學期鍵。

`inactive=true` 只轉 `home_study`（在家自學）；false／缺欄位為 enrolled。另保留 transferred、archived 兩種新狀態於 DDL，但舊匯出沒有可驗證資料時不產生。依據 `src/utils/helpers.js:187`、`src/utils/constants.js:164`。不把缺席、自學、刪除學生混為轉出或封存。

班級 ID 是 SHA-256(['class',來源班級編號])；其餘 ID 是 SHA-256([來源班級編號,表名,來源 path,舊編號])。無舊編號的 log、背包等用來源 path 作穩定定位，並報告需要舊 ID 的實體缺漏。批次 ID 的雜湊包含版本、班級編號、完整來源與 `decisions`。相同來源配相同決定可重跑出相同結果。來源內容、陣列順序或決定變動時會得到不同批次。

SQL 草稿以 ID 主鍵與批次／來源路徑唯一約束擋重複，legacy_ids 的 path 唯一約束另含表名。1B 必須將同 ID 同內容視為已處理，同 ID 異內容視為衝突，不能無條件 UPDATE。本次沒有實作資料庫寫入，不宣稱已驗證資料庫的重送、並行或權限。

## 錯誤降級與匯入對帳

| 來源檢查 | 處理 |
| --- | --- |
| `BALANCE_DRIFT` | 啟用期初調整後，差額由 `report.opening_adjustments` 記錄 |
| `TOTAL_EARNED_DRIFT` | 啟用期初調整後改列提示，保留已保存累計與舊算法重算值 |
| `UNKNOWN_TASK_SEMESTER`、`UNKNOWN_TRANSACTION_SEMESTER` | 指定月份規則後停止產生。非法日期仍以 `INVALID_TASK_DATE` 或 `INVALID_TRANSACTION_DATE` 擋匯入 |
| `TRANSACTION_BALANCE_DRIFT` | 保持非阻擋提示，對照歷史保存值與從零開始計算的餘額 |
| `ORPHAN_CORRECTION`、`AMBIGUOUS_REFERENCE`、`CORRECTION_CYCLE` | 仍擋匯入，列給遷移負責人裁決 |
| `UNKNOWN_ASSIGNMENT_LIST` | 列非阻擋提示，保留任務路徑 |
| `UNKNOWN_CURRENT_SEMESTER`、`INVALID_CURRENT_SEMESTER` | 來源目前學期空值時可由切換日解決。已填錯誤格式仍擋匯入 |

對帳重新走訪來源並比對轉換列。下列任一檢查失敗都列進 `differences`。

1. 已啟用期初調整時，每生所有交易的 `amount` 合計須等於該生帳戶的 `balance`。
2. 已啟用期初調整時，每生所有交易的 `earned_delta` 合計須等於該生帳戶的 `total_earned`。
3. 每筆更正須有根交易 ID，且沿前一筆關係能走到該根。
4. 每筆更正的 `effective_at` 和 `semester` 須等於根交易的值。
5. `chain_broken=true` 與 `kind=legacy_orphan_correction` 須雙向對應。
6. 每位學生最多一筆期初調整，且該筆的 `effective_at` 須為空值。
7. 依來源開始日及結束日核對兩份期間合計。舊版使用原日期、舊消費篩選及更正關係。新版加總 `effective_at` 的臺灣日期落在區間內的 `earned_delta`。`students[].period_comparison` 每個區間列 `legacy`、`current`、`difference`（新版減舊版）。舊統計被跳過時，`legacy` 與 `difference` 留空，新版仍對帳。

轉換結果的 `import_rules_enabled` 固定 `false`，交易 `legacy_semantics` 固定 `true`。匯入程序負責持久化與版本初始化。版本化資料的 `rev` 從 1 開始，`last_op_id` 為空值。繳交的 `basis_rev` 為 1，`assignment_active` 為 `true`，包含舊版缺鍵的待收列。匯入後可把該批次已寫入的繳交列交給 `reconcile(source, converted, { decisions, importedSubmissions })`，逐列核對編號、`rev`、`basis_rev` 與 `assignment_active`。

班級索引的學年、別名與狀態由收集來源的階段補齊。遷移負責人在 1D 檢視異常來源；需要班級情境的項目交由老師確認。座號以 `number` 為準並保留原 `seatNumber`。

## T-602 四項中度問題修正（2026-11-15）

**缺編號與空值參照：** 對帳的 lookup 與同 log 作業查找排除 legacy_id=null，和轉換索引一致。缺編號學生加空座位，或缺編號作業加字串 null 狀態鍵，都不會誤連；原本的缺編號與孤立參照錯誤仍保留。

**非物件陣列元素：** 對帳以具名 recordList／normalizeRecord 將學生、交易、背包、紀錄、作業、商品等陣列中的非物件視為 {}。來源快照與 INVALID_RECORD 保留原值；轉換、獨立驗證及對帳均可完成，錯誤清單一致且不放行匯入。

**undefined 頂層來源：** canonicalJson(undefined) 固定回傳字串 null，digest 可安全計算；三支工具統一正規化成 null，避免來源雜湊或根物件錯誤不一致。

**更正外鍵清空造成期間假差異：** 從獨立來源錯誤識別每位學生交易的 AMBIGUOUS_REFERENCE／CORRECTION_CYCLE，只跳過該生的舊算法期間比對，輸出 period_skipped: [{path,reason}]。該生其他欄位仍逐項驗證；其他學生的期間照常比對。反例 C、D2 無假差異，同場正常學生的交易金額被改仍抓得到期間差異。跳過不代表來源有效，原錯誤仍擋匯入。

本輪以虛構班級及合成交易驗證。執行 `npx vitest run` 和 `npx eslint server/migration`。`ddl-contract.test.js` 檢查輸出與 DDL 欄位、型別、約束文字；實際 PostgreSQL 寫入與交易驗證屬匯入階段。

## R2 寫入欄位掃描（2026-11-15）

方法：對整個 `src/` 執行 `rg -n` 搜尋 `setStudents|setLogs|setAllLogs|setSettings|setLocalSettings|onUpdateStudent|onUpdateSettings|updateSettings|updateProduct|saveClassCache|createTransaction`，再追蹤各 callback 的建立物件、動態 `[field]` 與彈窗 onChange；以預設常數及初始化 helper 交叉核對。

實讀：`src/App.jsx`、`src/views/DashboardView.jsx`、`src/views/SeatingView.jsx`、`src/utils/constants.js`、`src/utils/helpers.js`、`src/utils/classInherit.js`、`src/utils/storage.js` 的寫入包裝，以及 `src/components/dashboard/TaskBoard.jsx`、`src/components/modals/SettingsModal.jsx`、`settings/JobSettingsTab.jsx`、`settings/SyncSettingsTab.jsx`、`PassportModal.jsx`、`CommentModal.jsx`、`CommentPanel.jsx`、`AnnouncementModal.jsx`、`TeamManagementModal.jsx`、`src/components/seating/SeatingWaitingList.jsx`。

結果：新增 `shop.products[].description` 與相容 `storeItems[].description`（SettingsModal.jsx:433–444、1163）；完整保存在 products.raw。學生、bank/交易、背包、免交規則、評語、log/task/status、職務與指派、值日生、公告、貨幣、自動化、座位及自訂物件的其餘寫入欄位均已在上方清冊，未發現其他漏列。班級索引 alias/year/status/studentCount 與獨立 localStorage 的密碼、API key、同步設定不屬班級 JSON 匯出，不納入允許欄位；僅閱讀程式碼，未讀取任何設定值或憑證。還原與同步保留任意來源欄位，不代表它們是 UI 定義的已知欄位，仍逐筆報 UNKNOWN_FIELD。

R4：重複交易編號的累計重算仍取最後一筆，與舊 helper 的 Object.fromEntries 相同；AMBIGUOUS_REFERENCE 會列錯誤且更正外鍵為 null，阻擋匯入。重算數字用於比對舊版，不能把外鍵隔離解讀成修正歷史統計。

R5：reconcile 以獨立的 source-validation.js 走訪來源，重新檢查所有目前轉換器支援的來源錯誤；不呼叫 convert、不讀輸出列來判定來源有效性。錯誤以 code/path/value 的多重集合比較（忽略排列，保留重複次數），少報、多報、改值均在 errors 與批次 validation_errors 列差異；ready_for_import 使用獨立來源檢查結果與列差異。

R6：更正外鍵統一由 corrections.js 解析，只在同一學生交易中以嚴格相等 `tx.id === correctedTxId` 比對，排除 null/undefined；數字 101 與字串 101 不合併，避免建立舊版 DashboardView.jsx:496 不會選中的關係。0 與空字串仍是可比對的原編號；缺值與重複目標不猜填。一般學生／商品／職務的物件 key 參照仍沿用字串鍵規則。舊算法的期中／期末投影使用轉換列 id 與 corrected_transaction_id，來源關聯可解析時，輸出外鍵清空或指錯會檢出欄位及期間差異；來源本來就有歧義或循環則明列 period_skipped。來源累計與來源區間仍照舊 helper 的規則（含 truthy correctedTxId），不更改舊版統計。

R7：log.status 與各學生狀態容器均限非陣列物件；陣列、字串、數字、布林與 null 保留來源並報 INVALID_OBJECT，解析時視為空物件。已有學生容器時任務仍展開 pending/present=false，不從陣列或字串索引讀狀態。

R8：所有 SHA-256 輸入先以 canonicalJson 固定序列化，遞迴排序物件鍵，保留陣列順序與 JSON 型別；只改物件鍵排列時 batch_id/source_hash 與資料列 ID 不變。陣列換位仍代表內容變更。此修正會變更先前未匯入草稿的批次雜湊，正式切換須固定使用本版。

R9：students.group_key 與 groups.group_key 統一為 text／JS 字串，缺值仍為 null；students.raw.group 保留數字、字串等原值，unassigned 仍原樣保留。不補造缺少 groupAliases 的小組。

R10：新增 ddl-contract.test.js 對兩份假班逐列做 DDL 雙向檢查：每個輸出欄位須在 DDL，每個 DDL 欄位須由每列提供或明寫 DEFAULT；目前沒有省略由資料庫預設提供的欄位。另驗證型別與現有 CHECK 的布林／列舉限制，破壞測試包含 SQL 多欄、輸出缺欄／多欄、型別與 CHECK 錯誤。這是 SQL 草稿格式的靜態檢查，未替代 PostgreSQL 執行。另有歧義、自循環、孤立與非法金額的逐筆隔離斷言。

R11：legacyEarned 保留舊 helper 的 `(tx.amount || 0)` 行為，字串金額會串接，例如 100 與 25 的字串回傳字串 010025；此函式不是金額清洗器。convert 與 reconcile 的帳戶重算先驗有限數字，字串會報 INVALID_AMOUNT、typed amount 與重算為 null 並阻擋匯入；不擅自轉成數值。

R6 邊界補驗：外鍵目標編號為 0／空字串時仍建立有效關聯，但舊 helper 的商店更正篩選以 truthy 編號為條件。區間投影從已解析的目標列 legacy_id 保留此條件，不讀 raw.correctedTxId，避免換成雜湊 ID 後改變舊統計。
