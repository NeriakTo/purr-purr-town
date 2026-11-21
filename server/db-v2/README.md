# 改版資料庫寫入程序

第 1 包提供老師的手動點數調整（OP-24）、商店購買（OP-31）、操作重送與放棄，以及老師和小野共用的繳交狀態變更（OP-14）。第 2 包甲段新增作業建立、更新、作廢與恢復（OP-10 至 OP-13），以及規則存檔與停用（OP-38、OP-39）。第 2 包乙段補上每日任務獎勵、學生點收提議及其確認與退回（OP-15 至 OP-17）。第 3 包新增手動規則套用、更正與沖回、道具使用、商品存檔與停用及設定存檔。第 4 包加入撤銷（OP-50）。第 5 包加入訂正輪次（OP-18 至 OP-23）、五種訂正操作的撤銷及逾期排程（OP-52）。第 6 包加入歷史效果裁決（OP-53）、繳交限制及作廢沖回提示。第 7 包加入職務與指派（OP-35 至 OP-37）、值日設定與每日名單（OP-29）、一般發薪與值日薪資（OP-28、OP-30）及兩種發薪的撤銷。第 8 包補齊小野的呼叫紀錄、重送、上限與暫緩，並加入整批撤銷（OP-51）。第 9 包甲段加入班級資訊、封存與解除封存、學生及小組操作（OP-02 至 OP-09）。第 9 包乙段加入公告、座位與評語（OP-40 至 OP-42、OP-44 至 OP-47），丙段加入建班與承接（OP-01）及收尾驗收，規格的 51 種操作已到齊。資料表和函式位於 `ppt`。操作規格見 [v0.4 總則](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md)、[操作與點數](../../docs/revamp/operation-contract/02-操作規格-v0.4-操作與點數.md) 與 [連線、讀取與未決事項](../../docs/revamp/operation-contract/03-操作規格-v0.4-連線讀取與未決.md)。

## 資料表

| 表 | 用途與約束 |
|---|---|
| `classes` | 班級狀態、版本、從 0 起算的 `class_seq` 及可空的 `cutover_date`。班級資訊為可空的 `school_year`、`name`、`teacher` 與 `alias`，操作輸入及收據把 `teacher` 命名為 `teacher_name`。序號是提交游標，推進序號時班級資料的版本與最後改動者維持原值。匯入時寫入切換日，不推進版本。 |
| `class_ownership` | 班級與老師的對應，每班一位擁有者。 |
| `class_authorizations` | 以班級與身分種類為鍵，保存小野與排程授權。測試由 SQL 建立授權列。 |
| `operations` | 以全庫唯一的 `op_id` 保存操作者、輸入、內容雜湊、狀態和收據。`recorded_at` 記登記時間。只有成立的操作有 `class_seq` 與 `committed_at`。`class_id` 無班級外鍵，讓建班輸入被定案拒絕時仍能保存收據。`operations_one_committed_undo` 是部分唯一索引，只收成立的 `op.undo`，鍵是 `class_id` 與 `payload->>'target_op_id'`。`operations_one_committed_batch_undo` 只收成立的 `batch.undo`，鍵是 `class_id` 與 `payload->>'batch_id'`。 |
| `agent_calls` | 以全庫唯一的 `call_id` 保存班級、選填的 `note`、輸入順序的 `entries` 及呼叫時間 `created_at`。只有暫緩的呼叫會填 `held_inputs`，依原順序保存帶入外層班級與批次的完整新操作 JSONB。 |
| `students` | 以班級與學生編號為鍵，保存座號、姓名、可空的 JSONB 頭像 `avatar`、小組、在學狀態及版本。`exempt_rules` 預設為空陣列，每項有 `keyword` 與 `taskType`。 |
| `groups` | 以班級與 `group_key` 為鍵，保存組名、可空的本班組長 `leader_student_id` 及版本。 |
| `announcements` | 以班級與 `announcement_id` 為鍵，保存文字、選填的顏色與角度、移除旗標及版本。 |
| `seating` | 每班一列，保存列行數、視角、JSONB 座位及物件對照、自訂物件陣列與版本。 |
| `comments` | 以班級、學生及學期為鍵，保存觀察、評語、箴言、生成狀態、錯誤、分析、模型、建議稿及版本。兩個鎖定旗標沿用轉換器的 `locked_comment`、`locked_motto`，欄位型別為 JSONB 且值只允許布林。 |
| `accounts` | 每位學生一列，保存餘額、累計加分及版本。每寫一筆交易，帳戶版本加一並更新 `last_op_id`。 |
| `transactions` | 以班級與交易編號為鍵的存摺。來源與操作／轉換批次的關係由資料庫檢查，每筆根交易至多沖回一次。觸發程序擋下更新、刪除及清空。規則產生的交易記 `rule_id` 與 `rule_rev`。程序依 `effective_at` 的臺灣日期填 `semester`，無歸屬時間時留空。撤銷補回的根交易另記 `restored_from_transaction_id`，指向快照記下的原根交易。 |
| `rules`、`rule_versions` | 規則的 `rev` 指向現行版本。每班每個事件至多一條啟用規則，已發行的版本只能新增。建立規則與首版、調整現行版本與新增版本均須在同一交易完成。 |
| `effects` | 記學生、事件、對象、規則版本、根交易、來源、接替鏈及產生／沖回的操作。未裁決和裁決為未扣分的歷史效果，事件與根交易為空。候選交易可另記在 `suggested_transaction_id`，供畫面排序。同一班內，同一學生同一事件同一對象、同一接替鏈，各至多一筆有效效果。`payroll` 與 `duty_pay` 只供效果使用，規則編號及版本皆空。 |
| `tasks`、`submissions` | 作業列存標題、類型、可空的頁碼文字 `page_text`、發布日、截止日、學期及作廢狀態。繳交以班級、作業、學生為鍵，含狀態、版本、基準、是否參與及匯入時的狀態。 |
| `confirmations` | 保存 `leader_proposal` 與 `agent_held`。學生提議帶作業、學生、提議狀態。小野暫緩批次帶 `batch_id` 與 `held_reason`。兩者都保存建立及處理操作與時間，以及 `rev`、`last_op_id`。狀態是 `pending`、`confirmed`、`rejected` 或 `superseded`。部分唯一索引限制同班同一筆繳交最多一筆尚未處理的學生提議，`confirmations_one_agent_held_batch` 限制同班同批最多一筆小野暫緩項目。 |
| `corrections` | 每輪一列，以班級與 `correction_id` 為主鍵，外鍵指向本班作業及學生。保存 `round`、`status`、可空的 `due_on`、`note`、`overdue_on` 及版本欄位。同班、同作業、同學生的輪次唯一，另有部分唯一索引保證至多一列為 `required` 或 `returned`。`basis_rev` 介於 0 和 `rev` 之間，基準為 0 時狀態須為 `cancelled`。 |
| `products`、`inventory_items` | 商品列存價格、單位、庫存、可空的 `description` 及停用狀態。背包物品記購買時的名稱、圖示、購買交易編號及物品狀態。 |
| `settings_entries` | 以班級與設定鍵定位一筆 JSONB 設定。購買使用 `currency`。 |
| `jobs` | 以班級與職務編號為鍵，保存 `title`、`salary`、`icon`、`cycle`、`category`、`disabled`、`assignee_ids`、`origin` 與版本。指派名單以 JSONB 陣列整份保存。 |
| `daily_duties` | 以班級與 `duty_date` 為鍵，每天一列，保存 `student_ids` 陣列及版本。 |

所有編號用 `text`，可容納匯入的 64 字元編號。版本列預設 `rev = 1`、`last_op_id = NULL`。

效果的交易關聯與背包的購買交易關聯由寫入程序建立。存摺的清空保護沿用追加寫入觸發程序。

## 入口

- `ppt.submit_operation(op jsonb, actor jsonb) RETURNS jsonb` 接收含 `class_id` 的單筆操作。操作使用 `op_id`、`type`、`payload`，選填 `expect`、`batch_id`、`client_time`、`client_seq`。接受老師 `{"kind":"teacher","id":"<老師編號>"}`，以及 `ppt.scheduler_actor()` 回傳的固定排程身分 `{"kind":"scheduler","id":"scheduler"}`。排程須有該班的 `scheduler` 授權列。系統提交接受 `ppt.system_actor()` 回傳的固定身分 `{"kind":"system","id":"system"}`，適用於已存在的班級。老師的 `class.create` 另走建班入口，支援尚未有班級列的目標。
- `ppt.cancel_operation(class_id text, op_id text, actor jsonb) RETURNS jsonb` 只接受老師，登記放棄或回原收據。放棄新編號時，操作紀錄的 `type`、`payload`、`expect` 及內容雜湊皆為空。
- `ppt.agent_submit(class_id text, call_id text, ops jsonb, note text) RETURNS jsonb` 接收 1 到 50 筆操作。資料庫填入固定的小野身分、外層班級及批次編號。取得班級鎖後重驗授權，再依「小野的呼叫、上限與暫緩」處理。每筆執行各有儲存點，未預期例外使整次呼叫回復。
- `ppt.submit_locked_operation(p_op jsonb, p_actor jsonb) RETURNS jsonb` 是內部共用入口。外層須先驗信封、授權、編號、隔離層級，並持有已重驗授權的班級鎖。批次呼叫者可在同一交易逐筆使用。

各入口要求 `read committed`，其他隔離層級拋出 `25000`。入口由呼叫端提交或回復，班級鎖持有到該交易結束。每筆操作在持有班級鎖時取一次 `clock_timestamp()`，共用於該筆操作與它產生的交易。

## 收據

不保存的單筆結果固定為 `{ "op_id": "…", "status": "retry", "code": "…" }`。沒有字串形式的編號時，`op_id` 為 JSON null。小野入口的整批檢查失敗回 `{ "call_id": "…", "status": "retry", "code": "…" }`，整次不保存的結果包含 `CALL_ID_REUSED` 與 `HELD_QUEUE_FULL`。其餘回 `{ "call_id": "…", "receipts": […] }`，依清單原順序混排已保存的收據與單筆 `retry`。

保存的收據有 `op_id`、`status`、`code`、`replayed`、`class_seq`、`committed_at`、`result`、`changes`、`warnings`。非成立收據的序號與提交時間為 JSON null。

- `result` 有 `noop`、`transactions`、`effects_added`、`effects_reversed`。`transactions` 依寫入順序列交易編號。兩份效果清單各記 `effect_id`、`lineage_id`、`event`、`subject_kind`、`subject_key`、`root_transaction_id`。新增附 `amount`，沖回附 `rule_id`、`rule_rev`、`effective_amount`、`effective_at`。
- OP-53 的 `result.legacy_effect` 含 `effect_id`、`resolution`、`status`、`event`、`root_transaction_id`。回答 `none` 時，事件和根交易為 JSON null。
- OP-12 確實作廢且選沖回時，`result.unresolved_legacy_effects` 逐筆列出 `effect_id`、`student_id`、`subject_kind`、`subject_key`。清單可為空；有項目時另帶 `{"code":"LEGACY_EFFECT_SKIPPED","count":筆數}`。不選沖回或同值作廢時省略清單和提示。
- `LEGACY_EFFECT_UNRESOLVED` 的 `current` 為 `{"unresolved_legacy_effects":[{"effect_id":"…"}]}`，只列效果編號，老師與小野收到相同形狀。
- `changes` 各項記 `entity`、`key`、`prev_rev`、`rev`、`prev_value`、`value`、`last_op_id`。帳戶的值包含 `balance` 與 `total_earned`，多筆交易合併為交易前與交易後的整體變更。繳交也記 `prev_basis_rev`、`basis_rev`。同值成立時收據列出當前版本及值，資料列的最後改動操作維持原值。
- `task` 以 `{task_id}` 為鍵，建立時列出作業完整值，再依座號、學生編號列出初始繳交。更新列出變動欄位，同值成立時列出提交的欄位及當前值。作廢與恢復列出 `voided`。作廢沖回時，作業變更排在前面，每位受影響學生有一項帳戶變更。
- `rule` 以 `{rule_id}` 為鍵，值含 `kind`、`event`、`disabled`、`name`、`amount`、`icon`、`category`。
- `confirmation` 以 `{confirmation_id}` 為鍵。提議新建時列出完整值，`prev_rev` 為 0、`prev_value` 為 null。取代、確認或退回時，列出狀態、處理操作及處理時間的前後值。OP-15 的 `changes` 只列實際改動的待確認項目。
- `inventory.use` 的 `changes` 依序列 `inventory_item` 與 `account`。物品前後值各只有 `status`，由 `held` 變成 `used`。零元交易仍推進帳戶版本。
- 商品存檔與停用的 `product` 值含 `name`、`icon`、`price`、`price_unit`、`stock`、`initial_stock`、`description`、`disabled`。OP-31 的商品變更仍只列庫存。
- `job` 以 `{job_id}` 為鍵，值含 `title`、`salary`、`icon`、`cycle`、`category`、`disabled`、`assignee_ids`。`duty` 以 `{date}` 為鍵，值含 `student_ids`。兩者新建的 `prev_rev` 為 0、`prev_value` 為 JSON null。
- `setting` 以 `{key}` 定位設定列，前後值各為 `{"value": 設定值}`，新建的 `prev_value` 為 JSON null。
- OP-36 停用目前的值日職務時，`changes` 依序列 `job`、`setting`。設定項以 `{"key":"dutyJobId"}` 定位，前後值從 `{"value":"<job_id>"}` 變為 `{"value":null}`。設定版本推進後可用這筆 OP-36 作為 OP-43 的 `expect.after_op`。
- `RULE_VERSION_STALE` 的 `current` 只有 `rev` 和 `value.amount`。OP-26、OP-27 的 `STALE_STATE` 只回根交易的 `transaction_id` 與 `effective_amount`。
- 版本列的 `STALE_STATE` 的 `current` 有 `value`、`rev`、`last_op_id`、`actor`、`committed_at`。最後改動的資料取自同班的操作紀錄。目標列不存在時，`rev` 為 0，其他欄位為 JSON null。OP-14 的版本條件通過後，若 `only_if_no_proposal: true` 擋下操作，`current.proposal` 有 `confirmation_id`、`proposed_status`、`status`、`proposed_at`，其中 `proposed_at` 是提議的提交時間。
- `warnings` 是物件陣列，每項至少有 `code`。`LEGACY_DAY_NO_DAILY_QUEST` 另有 `student_id` 與 `date`，日期是 `YYYY-MM-DD`。每日任務交易仍列入 `result.transactions`，效果清單以 `event: daily_quest.complete` 識別，`subject_kind` 是 `date`，`subject_key` 是截止日。
- OP-25 的 `POSSIBLE_DUPLICATE` 含 `code`、`student_id`、`rule_id`、`prior_op_id`、`prior_actor_kind`、`prior_at`。這項提示照樣允許成立。
- 重送讀取已保存的收據，僅將回傳的 `replayed` 設為 `true`。同編號異班、異操作者或異內容回 `OP_ID_REUSED`。同班、同操作者提交已放棄的編號時，回 `cancelled`、`OP_CANCELLED`。放棄已存在的編號時，只比班級與操作者。
- 小野用同一個 `call_id`、同班且清單順序、編號和雜湊都相同時，逐筆重播操作紀錄目前的收據。說明文字沿用首次呼叫所存的值。班級或清單不同時整次回 `CALL_ID_REUSED`。清單中的既有操作保留原本的 `batch_id`。

## 檢查順序

1. 提交先檢查交易隔離層級，再驗信封。操作須為物件、有非空的字串 `class_id`，且 `payload` 以資料庫的 JSONB 文字輸出計算，最多 64 KiB UTF-8。信封不符回 `BAD_ENVELOPE`。
2. 單筆提交與放棄先驗傳入身分，無效身分拋出 `22023`。提交接受固定的排程及系統身分，放棄只接受老師。小野入口先檢查整批信封、重複編號、說明字數與清單大小。老師的 OP-01 先驗編號及取新班排隊鎖，來源班與已存在班級的存取檢查見「建班 OP-01」。其他提交驗班級存取權、編號格式及 OP-47 的推導編號，鎖住班級列後再驗一次存取權。班級不存在或無存取權都回 `CLASS_FORBIDDEN`，編號不符回 `INVALID_OP_ID`。這兩種回應都不登記操作。
3. 登記編號。主鍵處理跨班同編號競爭。已有編號時依重送規則比對，內容衝突回 `OP_ID_REUSED`。
4. 新操作依序檢查 `UNKNOWN_OP_TYPE`、`FORBIDDEN_ROLE`、`CLASS_ARCHIVED`、輸入的 `INVALID_PAYLOAD`、小野的 `SCOPE_FORBIDDEN`、`NOT_FOUND`、`ENTITY_INACTIVE`、`INVALID_TRANSITION`、`STALE_STATE`、各操作專屬檢查。專屬檢查若有 `ID_CONFLICT`，排在其餘專屬檢查之前。OP-50 與 OP-51 的目標檢查詳見各自的撤銷節。辨識 OP-01 至 OP-47、OP-50 至 OP-53。新班在此步檢查 OP-01 的輸入並建立資料。封存的例外是 OP-03。小野可呼叫 OP-14、OP-18、OP-19、OP-25 與 OP-50，撤銷限自己的操作。排程只可呼叫 OP-52，系統只可呼叫 OP-47。
5. 套用操作後，推進 `class_seq` 並保存收據。OP-24 的金額是非零整數，絕對值至多 100000，理由至多 100 字，省略或空白時存「手動調整」。帳戶可為負值，這筆交易的 `earned_delta` 等於 `amount`。

OP-14 接受 `expect.rev` 或同班且已成立的 `expect.after_op`。不存在或不參與的列接受 `rev: 0`；重新建立不參與的列會推進版本並重設基準。改成補交時保留作業扣分效果。其他狀態依現存效果沖回或新增。沖回採根交易的有效金額與原歸屬時間，包含 0 元沖回。版本通過後先檢查 `only_if_no_proposal`，再判斷同值與未裁決歷史效果。同值成立時保留待確認提議，真正改動才取代提議。

OP-31 檢查新物品編號、價格、庫存與餘額後，在同一交易扣款、建立背包物品及扣庫存。購買金額只計入餘額。

操作檢查或寫入要定案拒絕時，呼叫 `ppt.reject_operation(p_code ppt.operation_code, p_current jsonb DEFAULT NULL)`。這支函式使用 SQLSTATE `P604R`，把規格錯誤碼放在 `MESSAGE`，選填的 `current` JSON 放在 `DETAIL`。核心只攔這個 SQLSTATE，先回復該筆的檢查與寫入區塊，再把拒絕收據存進已登記的操作列。其他例外往外拋。偵測到已標記的未實作分支時，`ppt.pending_operation(p_key text)` 拋出 `0A000`，`DETAIL` 為該分支鍵。

## 建班 OP-01

`class.create` 只接受老師，禁帶 `expect`。輸入必帶 `class_id`、`school_year`、`name`、`teacher_name`、`alias`、`student_count`、`student_ids`，選填 `inherit_from_class_id`。班級編號須和信封一致。新班及學生編號使用第 4 版 UUID。學生人數須為 0 至 100 的整數，編號陣列須等長且無重複。四個班級資訊欄位的範圍沿用 OP-02。來源班編號接受非空字串，也可省略或為 JSON null。

驗完交易隔離層級、信封及身分後，老師的 OP-01 先檢查操作編號是否為第 4 版，再取 `pg_advisory_xact_lock(hashtextextended('ppt.class.create:' || class_id, 0))`。鎖持有到交易結束。對同一班同時建班的呼叫依序處理，後到的依提交後的班級與操作紀錄決定結果。

- 班級已存在時，鎖住班級列（`FOR UPDATE`）並驗擁有者。擁有者走原有登記與重送程序。新編號依序驗封存及輸入，檢查通過後回 `ID_CONFLICT`。
- 班級不存在時，若來源班編號是非空字串，先驗來源班擁有者、取來源班列的 `FOR SHARE`，再驗一次。封存的班也可作為來源。新班排隊鎖在前，來源列鎖在後。其後登記編號並處理重送，新編號才檢查輸入及建立資料。單筆核心在鎖內取操作時間。
- 成立會保留班級資料與操作紀錄，序號為 1。定案拒絕只保留一列操作紀錄而無班級序號，重送回原收據。班級不存在時對該筆編號放棄會回 `CLASS_FORBIDDEN`，仍可用新編號建同一班。`CLASS_FORBIDDEN`、`INVALID_OP_ID` 與未預期例外都不留資料。

新班狀態為 `active`、版本為 1，切換日為空值，授予呼叫者擁有權。按編號陣列順序建立座號 1 至 N、姓名「N號村民」、在學且未分組的學生，每人有一個零餘額帳戶。班級、學生與預設列的最後操作編號使用這筆 OP-01。

預設值取自 `src/utils/constants.js`，在 `src/App.jsx:38-72` 的舊版建班流程使用。

| 類別 | 值與出處 |
|---|---|
| `taskTypes` | 作業、訂正、攜帶物品、考試、通知單、回條（第 139 行）。 |
| `ruleCategories` | 作業、秩序、課堂表現、整潔，含舊版編號與圖示（第 70–75 行）。 |
| `currency` | 積分、小魚乾（100 積分）、貓餅乾（1000 積分），含舊版圖示（第 2–6 行）。 |
| `shopMeta` | 橘喵商店與 🐱 圖示（第 95–99 行）。 |
| 手動規則 | 作業缺交 −200、發表優良 +100、全勤獎勵 +500，含舊版圖示與分類（第 78–82 行）。 |
| 事件規則 | `submission.late` 作業遲交 −10、`submission.missing` 作業缺交 −20、`daily_quest.complete` 每日任務獎勵 +50（第 9–13 行供金額）。 |
| 職務 | 班長、衛生長、路隊長，沿用週期、薪資、圖示及分類（第 35–39 行）。 |
| 商品 | 減功課卡及五種午休卡，沿用價格、單位與圖示，庫存填初始庫存（第 85–92 行）。 |
| 座位表 | 6 列、8 欄、教師視角，空座位、空物件及空自訂物件陣列（第 60–67 行）。 |

規則從版本 1 起算，在本次操作時間生效。預設規則、職務與商品用 `uuid_v5` 在 `operation_uuid_namespace()`（`7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8`）下推導，名稱為 `class.create:<class_id>:<rule|job|product>:<代號>`。事件規則取事件代號，其餘取舊版預設清單的 `id`。

承接沿用來源班啟用職務、手動規則與商品的編號，職務的指派清空，手動規則由現行值建版本 1，商品庫存回到初始庫存（無初始庫存則用現有庫存）。複製四種設定，缺少的鍵填預設值。三條事件規則用新班的編號及來源現行的啟用金額，找不到則用預設金額。小組沿用鍵與名稱，組長清空。座位表沿用尺寸、視角、自訂物件與範圍內的格位物件，清空座位上的學生。來源沒有座位表時使用預設表。來源值日職務有被複製才承接 `dutyJobId`。來源班全程只讀。

承接排除來源學生、職務指派、值日名單、公告、座位上的學生、`semesterPeriods`、`currentSemester`、`agentLimits`、`correctionOverdueGraceDays`、切換日、交易、作業、繳交、效果、訂正、背包、評語、待確認項目、操作紀錄及小野與排程授權。承接時職務、手動規則及商品以來源的啟用列為準，空清單維持為空。

收據依序列班級、學生與帳戶（各按座號）、設定（按鍵）、規則（事件規則在前，同類按編號）、職務、商品、小組、座位（各按編號或鍵）。每項 `prev_rev` 是 0，`prev_value` 是 JSON null，`rev` 是 1。`result.class` 含 `class_id`、`student_count` 及 `inherited_from`，未承接時最後一鍵為 JSON null。

## 班級、學生與小組

這八種操作只接受老師，皆不可撤銷。封存班只接受 OP-03，包括把已封存的班再設為 `archived`。封存與解除封存僅改班級狀態及其版本欄位，不處理待確認項目、學生提議或訂正。放棄操作照常可用。

| 操作 | `expect` | `payload` | 檢查與成立結果 |
|---|---|---|---|
| OP-02 `class.update_info` | 必帶 | `name` 1 至 100 字、`alias` 與 `teacher_name` 各 0 至 100 字、`school_year` 1 至 20 字。四項都必帶。 | 先驗輸入，再驗班級版本。整份取代資訊，收據列四欄前後值。 |
| OP-03 `class.set_status` | 必帶 | `status` 為 `active` 或 `archived`。 | 先驗輸入，再驗班級版本。收據只列狀態的前後值。 |
| OP-04 `student.add` | 禁帶 | `student_id` 為小寫 UUID v4、`seat_number` 為 1 至 999 的整數、`name` 1 至 100 字。選填 `group_key` 1 至 50 字或 JSON null。 | 驗輸入後，本班已有編號優先回 `ID_CONFLICT`，再驗新編號及座號。建在學學生及零餘額帳戶，依序回 `student` 與 `account` 兩項新建變更。省略組別或帶 JSON null 時未分組。 |
| OP-05 `student.update_profile` | 必帶 | `student_id`，另帶 `name`、`seat_number`、`avatar` 至少一項。姓名、座號同 OP-04，頭像為 0 至 200 字或 JSON null。 | 驗輸入、查學生、驗版本，再查在學學生的新座號是否重複。只寫提供的欄位，JSON null 清除頭像。 |
| OP-06 `student.set_enrollment` | 必帶 | `student_id`、`enrollment_status`，狀態為 `enrolled`、`home_study`、`transferred` 或 `archived`。 | 驗輸入、查學生、檢查復學座號、驗版本。只改在學狀態，保留帳戶及既有紀錄。 |
| OP-07 `student.set_exempt_rules` | 必帶 | `student_id`、`rules` 陣列，至多 50 項；各項只含 `keyword` 與 `taskType`，各 1 至 50 字。 | 驗輸入、查學生、驗版本。照輸入順序整份取代 `exempt_rules`，只影響日後建立的作業。 |
| OP-08 `group.assign_students` | 頂層禁帶、每項必帶 | `items` 陣列 1 至 200 項，每項只含 `student_id`、`group_key`（1 至 50 字）及 `expect`，學生編號不可重複。 | 先驗所有輸入，再確認所有學生存在，逐位比對操作前的版本。全部通過才寫入，`unassigned` 清為空值。依輸入順序回每位學生的小組前後值。 |
| OP-09 `group.save` | 必帶，新建用 `rev: 0` | `group_key` 1 至 50 字且不得為 `unassigned`，`name` 1 至 100 字。選填 `leader_student_id` 為非空字串或 JSON null。 | 驗輸入、有指定組長就查本班學生，再驗小組版本。新建省略組長時為空值，更新省略時保留原值，帶 JSON null 時清除。 |

引用既有學生的編號接受非空文字，包含匯入編號。OP-04 不補既有作業的指派，後續可用 OP-14 帶 `rev: 0` 補上。座號重複只查本班 `enrolled` 或 `home_study` 的其他學生。OP-04、OP-05 的座號重複回 `INVALID_PAYLOAD`。原為 `transferred` 或 `archived` 的學生要改回這兩種在學狀態時，座號被占用會在版本檢查前回 `INVALID_TRANSITION`，可先用 OP-05 改座號。

OP-02 與 OP-03 共用班級列版本。過期時 `current.value` 含 `name`、`alias`、`teacher_name`、`school_year` 與 `status`。OP-05 至 OP-08 共用學生列版本。OP-05 至 OP-07 的過期現值含 `name`、`seat_number`、`avatar`、`group_key`、`enrollment_status` 與 `exempt_rules`。OP-08 使用 `per_item` 模式，項目可帶 `rev` 或 `after_op` 擇一，`rev: 0` 對既有學生一律不相符。過期時 `current` 為 `{ "items": [...] }`，只列不符項目，順序與輸入相同。各項有 `student_id`、`value`（只含 `group_key`）、`rev`、`last_op_id`、`actor`、`committed_at`。學生的分組可先於小組命名，組長可由本班其他組學生擔任。

設定型操作的同值提交照常取得序號，收據的 `prev_rev` 等於 `rev`，資料列保留原版本與最後改動編號。OP-08 只更新有變動的學生，所有項目都沒變時整筆為 `noop`。新建的 `group` 收據以 `{group_key}` 為鍵，值含 `name` 和 `leader_student_id`，更新時列出送來的欄位。班級與學生各以 `{class_id}` 和 `{student_id}` 為鍵。

## 公告與座位

OP-40 至 OP-42 只接受老師，皆不可撤銷。三種操作都必須帶 `expect`。收據依序以公告編號或班級編號定位資料列。

| 操作 | `payload` | 檢查與成立結果 |
|---|---|---|
| OP-40 `announcement.save` | `announcement_id`、`text` 1 至 500 字。選填 `color` 為 0 至 30 字或 JSON null，`rotation` 為 −360 至 360 的數字或 JSON null。 | 驗輸入、比版本，再驗新建的編號為小寫 UUID v4。新建用 `rev: 0`。整份取代，省略選填值會清空，儲存已移除的公告會重新啟用。 |
| OP-41 `announcement.remove` | 非空的 `announcement_id`。 | 驗輸入、查本班公告，再比版本。把 `removed` 設為 true 並保留原列。 |
| OP-42 `seating.save` | 六欄必帶。`rows`、`cols` 為 1 至 50 的整數，`view` 為 1 至 20 字。`seats` 與 `objects` 為物件，`custom_objects` 為陣列。`seats` 的值為不重複的非空學生編號。 | 驗輸入、查座位上的學生都在本班，再比版本。新建用 `rev: 0`。整份取代六欄，接受本班各種在學狀態的學生。 |

同值操作保留資料列版本並取得班級序號。公告收據的 `entity` 為 `announcement`，`key` 為 `{announcement_id}`。新建的值含文字、顏色、角度與移除狀態。OP-40 更新列出送來的內容欄位，OP-41 列出 `removed`。座位表的 `entity` 為 `seating`，`key` 為 `{class_id}`，收據值含整份六欄。座標由送出端管理，資料庫驗學生的班級及唯一性。

## 評語與系統身分

OP-44 至 OP-46 只接受老師，必須帶 `expect`，新建用 `rev: 0`。這三種操作依序驗輸入、查本班學生、比版本。目標由非空的 `student_id` 和 `semester` 定位，學期格式是兩至三位數年份加 `-1` 或 `-2`。

| 操作 | `payload` 除目標外的欄位 | 成立結果 |
|---|---|---|
| OP-44 `comment.save` | 至少帶一欄，`observation` 至多 5000 字、`comment` 至多 2000 字、`motto` 至多 200 字，均可為空字串。 | 手動存檔可改鎖定的文字。只套用送來的文字。 |
| OP-45 `comment.set_lock` | 必帶布林 `comment_locked`、`motto_locked`。 | 整份更新鎖定旗標。 |
| OP-46 `comment.request_generation` | 只帶目標。 | 版本相符後，兩欄都鎖定回 `COMMENT_LOCKED`。其餘進入 `generating` 並清除上次錯誤。已在產生中時成立並保留版本。 |

`STALE_STATE` 的 `current.value` 有 `observation`、`comment`、`motto`、`comment_locked`、`motto_locked`、`generation_status` 六欄。四種評語操作都不可撤銷，`changes` 的 `entity` 為 `comment`，鍵為 `{student_id, semester}`。新建回完整的評語列值，OP-44、OP-45 更新回送來的欄位，OP-46、OP-47 更新列出實際變動。成立但保留版本的 OP-46 也會回目標列及成立後版本。

OP-47 `comment.apply_generated` 只接受固定系統身分，禁帶 `expect`。除目標外必帶非空字串 `request_op_id`，並擇一帶結果或錯誤。結果包含 `comment`、`motto`（字數同 OP-44）、`analysis`（0 至 5000 字）、`model`（1 至 100 字）。錯誤為 `error`（1 至 500 字）。資料庫驗算 `op_id` 為 UUID v5，命名空間 `7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8`，名稱為 `comment.apply_generated:<request_op_id>`。第 5 版格式、推導值與請求編號型別在取班級鎖前核對。編號不符回 `INVALID_OP_ID`，不登記。登記後，找不到同班、同學生、同學期且已成立的 OP-46 時回 `NOT_FOUND`。

OP-47 以 OP-46 的成立收據版本比對現值。相符時，只將生成文字套用到未鎖定的欄位，保存分析與模型、改回 `idle` 並清除錯誤。錯誤結果設為 `failed` 並保存訊息。版本不符的生成結果存為建議稿 `suggestion`，含 `request_op_id`、`comment`、`motto`、`analysis`、`model`。晚到的錯誤訊息不保存。兩種晚到情況都保留人工文字及旗標，若仍在 `generating` 則改回 `idle`。收據的 `result.superseded` 記版本是否不符，`result.written` 列實際套用的生成文字欄位。每次請求只有一個套用編號，重送回原收據。

## 作業與規則操作

以下六種操作只供老師呼叫。輸入指 `payload`，表中列出完整的允許鍵。累加型禁止出現 `expect` 鍵。設定型必須帶 `{"rev": 整數}` 或 `{"after_op": "前一筆操作編號"}` 其中一種。

| 操作 | `expect` | 輸入 | 目標檢查與成立結果 |
|---|---|---|---|
| OP-10 `task.create` | 禁帶 | `task_id`、`title`、`task_type`、`published_on`、`due_on`，選填 `page_text`、`assignee_ids` | 檢查名單中查不到的學生、轉出或封存學生，再檢查作業編號是否已用過。依發布日計算學期，建立作業及名單上的繳交。符合自動免交規則的設為 `exempt`，其餘為 `pending`。兩種的版本與基準都從 1 起算。 |
| OP-11 `task.update` | 必帶 | `task_id`，以及 `title`、`task_type`、`page_text`、`due_on` 中至少一項 | 依序檢查作業存在、未作廢、版本相符。更新作業列，繳交、點數及效果原樣保留。 |
| OP-12 `task.void` | 必帶 | `task_id`、布林 `reverse_effects` | 檢查作業存在與版本。作業改成作廢。選沖回時逐筆結束有效效果，把根交易的有效金額取反寫入存摺，含零元。沖回也涵蓋這份作業底下各輪訂正仍有效的效果（確認獎勵與逾期扣分），依效果狀態挑選，不論輪次狀態。略過未裁決歷史效果並列在收據。繳交資料與版本原樣保留。第一次作廢會取代該作業尚未處理的全部學生提議。 |
| OP-13 `task.restore` | 必帶 | `task_id` | 檢查作業存在、目前作廢、版本相符，依序回 `NOT_FOUND`、`INVALID_TRANSITION`、`STALE_STATE`。恢復作業，繳交和點數原樣保留。 |
| OP-38 `rule.save` | 必帶，新建用 `rev: 0` | `rule_id`、`kind`、`name`、`amount`，事件規則必帶 `event`，選填 `icon`、`category` | 既有規則接受本班的非空文字編號，含匯入編號。先檢查版本，再檢查新建編號是否為小寫 UUID v4、種類或事件是否變動，以及啟用事件是否重複。改動時新增一版，於提交時間生效。儲存停用規則會重新啟用。 |
| OP-39 `rule.retire` | 必帶 | `rule_id` | 檢查規則存在與版本。停用時新增一版內容相同的版本列，已發生的交易與效果原樣保留。 |

## 小野的呼叫、上限與暫緩

小野只可送 OP-14、OP-18、OP-19、OP-25、OP-50。一次收 1 至 50 筆操作，說明可空、最多 1000 字。清單以 JSONB 的 UTF-8 文字計算，最多 512 KiB。單筆 `payload` 最多 64 KiB。重複的有效操作編號、說明或清單超限，皆在拿鎖前回 `BAD_ENVELOPE`。

拿到班級鎖後，取一次呼叫時間，依序處理。

1. 先認重送，再依全庫是否有該 `op_id` 分新舊。重送要求同班、同一 `call_id`、順序及每筆編號與內容雜湊相同。重送讀各筆目前的收據，沿用首次的說明，略過以下步驟。不同班或不同清單回 `CALL_ID_REUSED`。新呼叫的既有操作照原收據重播，或回 `OP_ID_REUSED`，保留原批次且不列入上限。新操作帶入外層班級與 `batch_id = call_id`。
2. 依序檢查單次人數、10 分鐘人數、今日或待確認的同學生同規則，以及同一呼叫重複的學生與規則。首項超限直接進入暫緩。
3. 依輸入順序試跑新操作。成立或定案拒絕各由單筆程序處理。
4. 依實際交易先驗單筆金額絕對值，再驗學生當日金額絕對值合計。若超限，試跑用 `P604H` 回復本次全部試寫，包含拒絕紀錄與班級序號。
5. 需要暫緩時，新操作全部存成 `held`，共用一筆 `agent_held` 待確認項目，暫緩與此前的試跑均未留下交易。既有操作依原本的結果回覆。
6. 若需要暫緩且未處理批次數已達上限，改回 `HELD_QUEUE_FULL`，本次不留下紀錄。老師處理一批後，同編號可重新提交。無須暫緩的呼叫不受佇列容量影響。

`agent_calls` 的 `entries` 依輸入順序記 `op_id`、十六進位 `content_hash`、`is_new`。全部是既有操作仍留呼叫紀錄，該次沒有新批次。收據由操作紀錄讀取。只有發生暫緩時，`held_inputs` 才保存正規化的新操作全文。`BAD_ENVELOPE`、`CLASS_FORBIDDEN`、`INVALID_OP_ID`、`CALL_ID_REUSED`、`HELD_QUEUE_FULL` 與未預期例外都不留呼叫紀錄。

| `agentLimits` 鍵 | 預設 | 算法 |
|---|---:|---|
| `max_students_per_call` | 5 | 本次新操作影響的不同學生。 |
| `max_students_per_10min` | 10 | 本次學生、最近 10 分鐘小野自行成立的操作，以及同一時間窗內建立且尚待確認的批次，取學生聯集。時間須晚於呼叫時間減 10 分鐘。 |
| `max_points_per_tx` | 200 | 本次任一筆交易的絕對值，包含小野撤銷時寫的沖回。 |
| `max_points_per_student_per_day` | 300 | 本次寫入可計入交易的各學生，合計其臺灣當日小野自行成立的交易絕對值。排除 OP-50 寫出的交易及老師確認後才成立的操作。後來遭更正、沖回或撤銷的原交易仍計入。 |
| `max_pending_held` | 5 | 本班狀態為 `pending` 的小野暫緩項目。 |

OP-43 可更新五個設定值。缺列時讀取預設值。前四個上限嚴格大於才觸發，待確認數等於上限即為已滿。「今天」是呼叫時間換成 `Asia/Taipei` 的日期。

計算學生時，字串形式的 `payload.student_id` 直接計入，包含本班查不到的編號。OP-19 取本班訂正輪次的學生。OP-50 只沿本班小野自己的原操作找學生，原操作本身是撤銷時停止。其他情況沒有學生。輸入上限在操作本身的角色與版本檢查之前計算。

OP-25 的「今日已套用」查本班同學生、同規則、在臺灣當日的 `adjust` 交易，操作者不限，交易後續的更正或沖回不影響判斷。尚待確認的同學生同規則也會觸發暫緩。

暫緩的 `held_reason` 依檢查順序為 `max_students_per_call`、`max_students_per_10min`、`rule_applied_today`、`duplicate_rule_in_call`、`max_points_per_tx`、`max_points_per_student_per_day`。待確認項目的 `confirmation_id`、`created_op_id`、`last_op_id` 都用第一筆新操作的編號，`created_at` 用呼叫時間。每筆新操作回 `held`、`HELD_FOR_TEACHER`，無序號與提交時間。收據的四個預設 `result` 鍵另加 `confirmation_id`、`held_reason`。

老師送 OP-16 時，依 `held_inputs` 原順序以小野身分和 OP-16 的時間重跑，以原操作編號保存結果。略過小野上限；若自暫緩時間起已寫入同學生同規則的 `adjust`，包括這次確認中稍早執行的成員，該筆 OP-25 優先定案為 `HELD_OP_OUTDATED`。暫緩前的套用不觸發這一碼。OP-17 將成員全部定案為 `CONFIRMATION_REJECTED`。兩個拒絕碼皆省略 `current`。

OP-16 與 OP-17 先驗輸入，再驗本班項目存在且尚待確認。資料不完整時丟出一般例外，整筆回復。處理後，待確認項目記 `processed_op_id` 與 `processed_at`，外層收據只列該項目的變動，`result.held` 為 `{ "batch_id", "items": [{ "op_id", "status", "code" }] }`，按原順序列成員。外層在成員之後取得序號，小野重送原呼叫可讀取已定案的收據。

## 學生點收與每日任務

OP-15 至 OP-17 只供老師呼叫，禁帶 `expect`。既有實體的編號以非空字串在本班查找。

| 操作 | 輸入 | 目標檢查與成立結果 |
|---|---|---|
| OP-15 `submission.propose` | `task_id`、`student_id`、`proposed_status` | 提議 `on_time`、`late`、`missing` 時，依序檢查參與中的繳交存在、作業及學生有效、繳交待收。舊資料的 `unknown` 視同待收。先取代尚未處理的提議，再以本操作的 `op_id` 建立新項目。傳 `pending` 表示收回，只檢查參與中的繳交存在，再取代尚未處理的提議。無項目可收回時 `result.noop` 為 `true`、`changes` 為空。提議與收回都保留繳交與點數。 |
| OP-16 `confirmation.confirm` | `confirmation_id` | 先檢查項目存在且尚未處理，再查作業、學生及繳交是否符合點收條件。使用 OP-14 的繳交寫入與效果流程，並在同一筆操作把提議標成已確認。 |
| OP-17 `confirmation.reject` | `confirmation_id` | 檢查項目存在且尚未處理後標成已退回，保留繳交與點數。 |

已確認、退回或被取代的項目回 `CONFIRMATION_NOT_PENDING`。種類為 `agent_held` 時，兩種操作依「小野的呼叫、上限與暫緩」處理批次。

OP-14 與 OP-16 真的改動繳交時，在同一交易判定這位學生於作業截止日的每日任務，包含重新建立繳交。條件只看該日截止、未作廢且有參與中繳交的作業。全部為準時、補交、請假或免交，並至少有一筆準時，才算達成。

- 達成且沒有有效獎勵時，依現行事件規則發獎勵。沒有現行規則或金額為 0 時跳過。
- 未達成且已有有效獎勵時，依原根交易的有效金額沖回，包含 0 元。
- 如果判定範圍內有一筆匯入時已點收的繳交（`legacy_status_at_import` 非空且非 `pending`，含 `unknown`），保留現有效果並帶提示。有無現行規則皆適用。
- 建立、作廢、恢復作業、同值點收、提議與退回都維持每日任務原狀。

## 手動規則、交易、商店與設定

下表列出 `payload` 的允許鍵。OP-25 開放給老師和小野，其餘僅供老師呼叫。禁帶的 `expect` 包含 JSON null。必帶的 `expect` 要用 `rev` 或 `after_op` 其中一種，只有新建接受 `rev: 0`。

| 操作 | `expect` | 輸入 | 目標檢查與成立結果 |
|---|---|---|---|
| OP-25 `points.apply_rule` | 禁帶 | `student_id`、`rule_id`、正整數 `rule_version` | 先查本班學生與規則，查不到時老師回 `NOT_FOUND`、小野回 `SCOPE_FORBIDDEN`。再擋轉出或封存的學生與停用的規則、事件規則、版本不符。以指定版本的名稱與金額寫一筆 `adjust`，含零元，不建立效果。 |
| OP-26 `tx.correct` | 禁帶 | `transaction_id`、數字 `expect_effective_amount`、整數 `new_amount`，選填字串 `reason` | 從本班編號找到根交易，依序檢查存在性、可更正性、是否已沖回與有效金額。更正差額歸在根交易，沿用歸屬時間。 |
| OP-27 `tx.reverse` | 禁帶 | `transaction_id`、數字 `expect_effective_amount` | 依序檢查存在性、可沖回性、是否已沖回或有效金額已為零，以及有效金額是否相符。以有效金額的反號寫沖回，並標記連到根交易的有效效果。 |
| OP-32 `inventory.use` | 禁帶 | `item_id` | 依序檢查物品存在、已退回、已使用。把持有物品改為已使用，寫入零元 `item_use`，理由是「使用道具」加上物品保存的品名。 |
| OP-33 `product.save` | 必帶 | `product_id`、`name`、`price`、`price_unit`、`stock`、`initial_stock`，選填 `icon`、`description` | 完整建立或取代商品內容，並啟用商品。先驗版本，再驗新建編號是小寫 UUID v4。已啟用且內容相同時成立但不更新。 |
| OP-34 `product.retire` | 必帶 | `product_id` | 查本班商品存在後比對版本。停用保留庫存與既有物品。已停用時成立但不更新。 |
| OP-43 `setting.set` | 必帶 | `key`、`value` | 先驗設定鍵與新值，再比對本班該鍵的版本。值相同時成立但不更新。 |

### 設定值

| 鍵 | 接受的新值 |
|---|---|
| `currency` | 含 `base`、`tier1`、`tier2` 三個物件。後兩者的 `rate` 須為 1 至 100000 的整數。名稱及圖示不驗。既有的字串匯率仍可供購買讀取。 |
| `agentLimits` | 恰有 `max_students_per_call`、`max_students_per_10min`、`max_points_per_tx`、`max_points_per_student_per_day`、`max_pending_held` 五鍵。各值為 1 至 100000 的整數。 |
| `correctionOverdueGraceDays` | 0 至 365 的整數。 |
| `dutyJobId` | JSON null 或本班未停用的職務編號。職務查找及有效性檢查排在設定版本之前。停用目前的值日職務會將這個設定清成 JSON null。OP-28 跳過這個職務，OP-30 取用它的現行薪資。 |
| `currentSemester` | JSON null，或兩至三位數年份加 `-1` 或 `-2`。 |
| `taskTypes` | 不重複的非空字串陣列。 |
| `ruleCategories` | 物件陣列。 |
| `semesterPeriods` | 各值皆為物件。有 `start` 或 `end` 時，各值須為 JSON null 或有效的 `YYYY-MM-DD` 日期。 |
| `shopMeta` | 物件。 |

## 職務、發薪、值日

六種操作都只供老師呼叫。下表列出 `payload` 的完整允許鍵。必帶的 `expect` 用 `rev` 或 `after_op` 擇一，只有新建接受 `rev: 0`。禁帶時，傳 JSON null 也會被拒絕。日期採有效的 `YYYY-MM-DD`，可補發過去的期別。`include_legacy_periods` 只接受布林，預設為 `false`。

| 操作 | `expect` | 輸入 | 目標檢查與成立結果 |
|---|---|---|---|
| OP-28 `payroll.run` | 禁帶 | `job_ids`，選填 `pay_date`、`include_legacy_periods` | 先查全部職務，任何一個查不到就拒絕整筆。依送來的職務順序發放，職務內依學生編號排序。省略日期時，用提交時間的臺灣日期。 |
| OP-29 `duty.set` | 必帶，新建用 `rev: 0` | `date`、`student_ids` | 先查本班學生，再查當天名單的版本。依輸入順序新增或整份取代名單，允許空名單。保留已發的薪資。 |
| OP-30 `duty.pay` | 禁帶 | `date`，選填 `include_legacy_periods` | 值日職務未設定、設定為空、指定日無名單列或名單為空，皆回 `INVALID_TRANSITION`。設定引用缺失的職務時拋出資料異常。依指定日期的名單按學生編號順序發放，金額取當下的值日職務薪資。 |
| OP-35 `job.save` | 必帶，新建用 `rev: 0` | `job_id`、`title`、`salary`、`cycle`，選填 `icon`、`category` | 先查版本，再驗新建編號為小寫 UUID v4。整份存檔，更新時保留指派與來源。存檔可重新啟用停用職務，已發薪資保留。 |
| OP-36 `job.retire` | 必帶 | `job_id` | 先查職務再查版本。停用並保留指派。若為目前的值日職務，同時清除設定並推進設定版本。 |
| OP-37 `job.set_assignees` | 必帶 | `job_id`、`student_ids` | 依序查職務與學生是否存在、職務是否停用、職務版本。依輸入順序整份取代指派，允許空名單。 |

設定型同值操作成立且保留資料列版本。OP-29、OP-35、OP-36、OP-37 不可撤銷。引用現有職務與學生時接受非空字串，含匯入編號。`job_ids` 至少含一項，職務與學生名單的項目都須是互不重複的非空字串。OP-29、OP-37 可保存轉出或封存學生。

### 期別與切換日

| 週期 | 期別 | 第一天 |
|---|---|---|
| `daily` | `YYYY-MM-DD` | 當天 |
| `weekly` | ISO 年和週，例如 `2026-W53` | 該週星期一 |
| `monthly` | `YYYY-MM` | 當月 1 日 |
| `semester` | 依 `semester_at(pay_date)` 得學期代號 | 上學期從 8 月 1 日起，含翌年 1 月。下學期從 2 月 1 日起。 |
| `once` | `once` | 無 |

期別第一天早於班級 `cutover_date` 時，OP-28 預設保留待確認。OP-30 直接比指定日與切換日。同日可發；班級切換日為空時照常發放。一次性職務依來源判定，`origin = migration` 即須確認，含班級切換日為空的情況。帶 `include_legacy_periods: true` 可發給合格且尚未領取的學生。班級切換日與 `origin = migration` 由匯入程序寫入，現階段以測試資料驗證。舊版薪資與值日紀錄保留原樣，不建立薪資效果，也不供新版判定是否已發。

### 發薪收據與防重

每筆薪資寫一筆 `payroll` 交易及一筆效果。交易金額和 `earned_delta` 等於當下薪資，`occurred_at` 與 `effective_at` 同為該操作的提交時間。理由格式是「職稱 薪資 (期別或日期)」。一般發薪的效果事件是 `payroll`、對象種類是 `job_period`、對象鍵為 `<job_id>|<期別>`。值日薪資的效果事件是 `duty_pay`、對象種類是 `date`、鍵為指定日期。同班、同學生、同事件及對象已有有效效果才算已發。沖回後可再發。

兩種發薪成立時都回 `result.paid` 與 `result.skipped`，沒有項目時為空陣列。已有同一期有效效果的學生優先列為 `already_paid`。交易與新增效果按寫入順序排列。帳戶變更依學生編號排序，同一學生多筆交易合併成一項。

| 操作 | `paid` 項目 | `skipped` 項目與原因 |
|---|---|---|
| OP-28 | `{job_id, period, student_id, transaction_id, amount}` | `{job_id, period, student_id, reason}`。`duty_job` 每個職務一項，期別與學生為 null。`already_paid` 逐人列。跨切換日且未確認時，若有合格學生尚未領取，先逐人列 `already_paid`，再列一項 `legacy_period`，學生為 null。 |
| OP-30 | `{student_id, date, transaction_id, amount}` | `{student_id, date, reason}`。逐人列出已發的 `already_paid`，或切換日前尚未發且未確認的 `legacy_period`，日期採送出的日期。 |

一般發薪先略過停用職務，再列值日職務，接著略過零薪資。停用職務、兩種發薪的零薪資及轉出或封存學生均不列為待確認或已發。沒有交易時成立為 `noop`，`changes` 為空，仍取得班級序號。

值日薪資由三個條件維持單一入口。

1. OP-28 在班級鎖內讀取一次 `dutyJobId`，跳過該職務。
2. OP-30 依指定日的值日名單發薪，以學生加日期為判定對象，職務指派不參與。
3. 兩個入口共用班級列鎖，依序完成檢查與寫入。效果的唯一索引分別保護各事件與對象。

### 已知限制

- 兩次發薪間若清除或換掉目前的值日職務，舊職務可能改由 OP-28 發薪，同時在指派與值日名單上的學生可能另領一筆。
- 發薪後改週期，新的週期可使用不同的期別鍵，可能對同一時段再發一次。
- 切換日當天的日薪與值日薪資可以發放。若舊版當天已發薪，須在切換作業時核對存摺。

## 訂正輪次

| 操作 | `expect` | `payload` | 來源狀態與成立結果 |
|---|---|---|---|
| OP-18 `correction.require` | 禁帶 | `correction_id`、`task_id`、`student_id`，選填 `due_on`、`note` | 作業與學生有效，且同一組尚無未結束輪次。建立 `required`，版本與基準都是 1。這位學生可以沒有該作業的繳交。 |
| OP-19 `correction.mark_returned` | 必帶 | `correction_id` | `required` → `returned`。 |
| OP-20 `correction.confirm` | 必帶 | `correction_id` | `required` 或 `returned` → `confirmed`。依現行 `correction.confirmed` 事件規則發獎勵，規則缺少、停用或金額為 0 時只更新訂正。 |
| OP-21 `correction.redo` | 必帶 | `correction_id`、`next_correction_id`，選填 `next_due_on` | `returned` → `redo`，再建立下一輪 `required`，版本與基準都是 1，備註空白。收據依序列舊輪、新輪。更新下一輪時可用這筆操作的 `after_op`。 |
| OP-22 `correction.cancel` | 必帶 | `correction_id`、布林 `reverse_effects` | `required` 或 `returned` → `cancelled`。選沖回時，依事件排序，把這一輪仍有效的效果按各根交易有效金額沖回，包含 0 元，並保存快照。選保留時，效果和餘額照原值保留。 |
| OP-23 `correction.set_due` | 必帶 | `correction_id`、可為 JSON null 的 `due_on` | `required` 或 `returned` 可改期限，逾期日期與效果保留。新舊值相同時成立並取得序號，`result.noop` 為 true，收據列當時的版本與同值的期限。 |

OP-18 先驗輸入，再查作業與學生，並依序擋下無效目標、已有未結束的一輪、本班已使用的新編號。OP-19 至 OP-23 先驗輸入，再查本班輪次。OP-20、OP-21 接著驗作業未作廢且學生未轉出或封存。這五種最後依序檢查來源狀態、版本條件，以及 OP-21 的新編號衝突。老師查不到回 `NOT_FOUND`，小野回 `SCOPE_FORBIDDEN`。來源狀態不符回 `INVALID_TRANSITION`，包含狀態已是目標值。

`changes` 以 `entity: correction`、`key: {correction_id}` 識別資料列，含 `prev_basis_rev`、`basis_rev`。新增列的 `prev_rev` 與 `prev_basis_rev` 為 0，`prev_value` 為 null，`value` 有 `task_id`、`student_id`、`round`、`status`、`due_on`、`note`、`overdue_on`。既有列只回本次欄位的前後值，OP-19 至 OP-22 更新 `status`，OP-23 更新 `due_on`。有交易時，帳戶變更列在訂正變更之後，交易及效果沿用既有 `result` 欄位。

訂正的 `STALE_STATE.current.value` 只帶 `status`、`round`、`due_on`、`overdue_on`。小野另只收到 `current.actor.kind`。OP-18 的新列收據含呼叫者自己送來的 `note`。訂正操作及其撤銷皆維持每日任務原狀。

## 訂正逾期排程 OP-52

`schedule.correction_overdue` 只接受有班級授權的排程身分，封存班回 `CLASS_ARCHIVED`。唯一的輸入鍵是 `payload.date`，值須為有效的 `YYYY-MM-DD`，禁止帶 `expect`，包含 JSON null。

「今天」以輸入日期為準。每次讀取本班當下的 `correctionOverdueGraceDays`，缺值採 1 天。符合對象是有期限、仍為 `required`、且輸入日期嚴格大於期限加寬限天數的輪次。跳過已作廢作業與已轉出或封存的學生，恢復有效後由下一次排程依當時條件處理。

1. 依學生編號、訂正編號以 `COLLATE "C"` 排序處理。首次標記時把 `overdue_on` 設為輸入日期，推進 `rev` 與 `basis_rev` 並更新 `last_op_id`，狀態原樣保留。
2. 只有從未有過 `correction.overdue` 效果的輪次才可新增逾期交易與效果，有效、已沖回及依快照補回的效果都算已有。規則缺少、停用或金額為 0 時，仍會記逾期日期。之後有非零現行規則時，仍符合條件且從未扣過的輪次可補扣。單獨沖回或改期限後維持已扣過的紀錄。
3. `changes` 先列變動輪次（前後值只含 `overdue_on`），再依學生編號列帳戶。同一位學生多筆交易合併為一項帳戶變更。`result.transactions` 與 `effects_added` 依寫入順序。交易的 `occurred_at`、`effective_at` 都用操作提交時間。既未標記也沒有交易時，`result.noop` 為 true，`changes` 為空，仍取得 `class_seq`。

同編號同內容重送回原收據。同日使用另一個有效 v5 編號可成立，由輪次的效果歷史阻止重複扣分。OP-52 不可撤銷。記過逾期日後，建立該輪的 OP-18 會因基準改變而無法撤銷。老師可用 OP-22 取消並選擇沖回。

## 歷史效果

已對應的歷史效果與新版效果共用繳交矩陣、OP-27 單獨沖回、OP-12 作廢沖回及 OP-50 依快照補回。沖回以舊根交易的有效金額為準，歸屬時間沿用根交易。快照的規則編號和版本為 JSON null。新扣分採現行規則。補交保留當時的效果，單獨沖回後再改狀態時只處理仍有效的扣分。

OP-14 依序驗版本、`only_if_no_proposal`、同值，再檢查同班同學生同作業有無未裁決效果。老師和小野遇到未裁決效果時都可改補交，保留歷史效果及交易；其餘狀態變更保存 `LEGACY_EFFECT_UNRESOLVED` 拒絕。效果編號依 `COLLATE "C"` 排序。OP-16 確認學生提議也用這道檢查。匯入時已點收的繳交觸發每日任務判定時，沿用 `LEGACY_DAY_NO_DAILY_QUEST`。

OP-53 `legacy_effect.resolve` 只供老師呼叫。必帶 `expect`，以 `rev` 或 `after_op` 比對繳交版本，`rev: 0` 一律不符。輸入只允許 `effect_id`、`resolution`、`transaction_id`、`event`。編號以非空字串引用同班既有資料。回答 `link` 必帶交易編號，回答 `none` 時省略交易與事件。補交回答 `link` 必須指定 `submission.late` 或 `submission.missing`，遲交與缺交則由繳交狀態決定事件。

1. 驗輸入與版本條件的格式。查效果及指定的交易，查不到回 `NOT_FOUND`。效果已裁決、已沖回或由新版產生時回 `INVALID_TRANSITION`，再查效果所指作業和繳交。作業已作廢或學生已轉出、封存時仍可裁決。
2. 比對繳交版本，版本不符回 `STALE_STATE` 並帶目前繳交值。版本通過後，`link` 依序檢查事件與狀態是否相容、交易是否合格，以及是否已有同學生、同作業、同事件的有效效果。依序失敗時各回 `INVALID_PAYLOAD`、`TX_NOT_REVERSIBLE`、`INVALID_TRANSITION`。
3. 連結對象須為同學生的 `legacy_general` 舊根交易，有效金額為負，且沒有成為任何效果的根交易。用 `effective_at` 的臺灣日期比發布日，當日可連結，早於發布日或日期無法取得時拒絕。建議交易欄只供排序。
4. `link` 將效果設成 `active` 並填事件與根交易，`none` 將效果設成 `dismissed`。兩種都保留候選欄，將繳交 `rev` 加一、`basis_rev` 設為新版本，並更新 `last_op_id`。繳交狀態、參與、提議、交易和帳戶均維持原值。收據只有一項繳交變更，前後值相同，並另列裁決結果。

接著可用 OP-53 的操作編號帶入 OP-14 的 `after_op`。裁決成立後，原版本即不符；裁決被拒絕時，接在它之後的 OP-14 也會回 `STALE_STATE`。先改補交再裁決會推進基準，所以撤銷先前的補交回 `UNDO_CONFLICT`、`reason: basis_changed`，`current.last_op_id` 指向裁決操作。裁決前仍可撤銷補交。OP-53 本身不可撤銷，若要退舊扣分可用 OP-27。

OP-12 真的作廢且選沖回時，逐筆沖回仍有效的作業效果，依學生編號、效果編號以 `COLLATE "C"` 列出未裁決歷史效果。未裁決仍維持原狀，之後可用 OP-53 裁決。已裁決為未扣分的效果省略。選沖回的範圍含這份作業底下各輪訂正的有效效果（專案負責人 2026-11-21 裁定）。恢復作業不補回，逾期扣分不會再扣。

### 匯入欄位對照

依規格 7.5 A、E 和 7.4 I，匯入的作業與繳交使用轉換器的穩定編號。只有狀態為遲交、缺交或補交、且來源繳交存在並可解析學生與作業時，才產生一列歷史效果。每筆繳交至多一列歷史效果，匯入時驗證每列的接替鏈編號各自唯一。

| 轉換器 `legacy_effects` 欄位 | 匯入後的欄位或用途 |
|---|---|
| 共同 `id` | `effects.effect_id`，64 字元小寫十六進位；`lineage_id` 使用同一值。 |
| 共同 `class_id` | `effects.class_id`，與對應的作業、學生、繳交及交易同班。 |
| 共同 `batch_id` | 效果表無對應欄位，批次歸屬須在轉換或匯入產物留存。 |
| 共同 `source_path` | 源於繳交來源路徑，效果表無對應欄位。 |
| 共同 `legacy_id` | 轉換時留空，效果表無對應欄位。 |
| 共同 `raw` | 三組判定筆數供轉換對帳，效果表無對應欄位。 |
| `submission_id` | 繳交無獨立編號。匯入時核對它指向的 `submissions` 複合鍵 `(class_id, task_id, student_id)`。 |
| `student_id` | `effects.student_id`。 |
| `task_id` | `effects.subject_key`，`subject_kind` 固定為 `task`。 |
| `link_state` | 依候選及裁決輸入決定 `effects.status`，原始候選狀態無獨立欄位。 |
| `event` | 候選獲接受時填 `effects.event`；其餘留空。 |
| `transaction_id` | 候選獲接受時填 `root_transaction_id`，否決或試匯入未裁決時填 `suggested_transaction_id`；無候選時兩欄皆空。 |
| `amount_at_link` | 轉換時對帳資料，效果表無對應欄位；操作以帳本根交易的有效金額為準。 |
| `unresolved_reason` | 轉換報告的診斷資料，效果表無對應欄位。 |

匯入後三種效果形狀如下。共同填 `origin: legacy`，`rule_id`、`rule_rev`、`created_op_id`、`reversed_op_id` 皆空。

| 匯入結果 | `status` | `event` | `root_transaction_id` | `suggested_transaction_id` |
|---|---|---|---|---|
| 候選獲接受 | `active` | 遲交或缺交事件 | 舊交易編號 | 空 |
| 無候選 | `legacy_unresolved` | 空 | 空 | 空 |
| 候選被否決或試匯入未裁決 | `legacy_unresolved` | 空 | 空 | 候選交易編號 |

匯入程序對有版本的列設 `rev = 1`、`last_op_id = NULL`。繳交另設 `basis_rev = 1`、`assignment_active = true`，把轉換出的狀態同步填入 `status` 與 `legacy_status_at_import`，之後保留匯入狀態原值。匯入程序會把批次 `cutover_date` 寫入班級欄位。效果表的來源追溯資料去向由匯入工單決定。目前的驗收使用 SQL 建立上述匯入結果。

## 撤銷 OP-50

`op.undo` 屬累加型，禁止帶 `expect`，包含 JSON null。唯一的 `payload` 鍵是 `target_op_id`，接受既有操作的非空字串編號。老師可以撤銷本班任何操作者的操作，小野只能撤銷本班自己的操作。

1. 在本班查原操作。老師查不到回 `NOT_FOUND`。小野查不到或原操作屬於其他操作者，一律回 `SCOPE_FORBIDDEN`。兩者都省略 `current`。
2. 原操作未成立或不在下表時，回 `NOT_UNDOABLE`。已被成立的撤銷處理過時，回 `ALREADY_UNDONE`。原操作的 `result.noop` 是 true 時，直接成立。
3. 繳交類與五種訂正操作先查作業與學生是否有效。作業已作廢，或學生已轉出、封存時回 `ENTITY_INACTIVE`。逐項比較目前列的 `basis_rev` 與原收據的 `rev`，不符回 `UNDO_CONFLICT`（`basis_changed`）。OP-21 先驗本輪，再驗新輪。
4. 依下表預檢各操作的其餘前提。通過所有檢查才寫入。一筆定案拒絕只保存拒絕收據，班級序號維持原值，也不佔用原操作的撤銷名額。

| 原操作 | 其餘前提 | 成立時的寫入 |
|---|---|---|
| OP-14 `submission.set_status` | 要補回的效果不可撞到同一有效效果或接替鏈。這次會先沖回的效果可排除。 | 回復繳交、反做效果並重判截止日的每日任務。 |
| OP-16 `confirmation.confirm` | 只支援學生點收提議，繳交與效果的前提同 OP-14。 | 同 OP-14，已確認的提議保留原值。 |
| OP-18 `correction.require` | 無。 | 保留新建輪次，設為 `cancelled`、基準 0。 |
| OP-19 `correction.mark_returned` | 無。 | 回到 `required` 與原基準。 |
| OP-20 `correction.confirm` | 回復後不得同時存在另一未結束輪次。 | 回到確認前的狀態與基準，沿接替鏈沖回原確認獎勵。獎勵已沖回時跳過，改過金額時依現值沖回，兩種都沿用既有提示。 |
| OP-21 `correction.redo` | 回復後不得同時存在另一未結束輪次，本操作建的新輪排除在檢查外。 | 先把新輪設成 `cancelled`、基準 0，再回復舊輪的狀態與基準。 |
| OP-22 `correction.cancel` | 先查有無另一未結束輪次，再查補回效果會不會與有效效果衝突。 | 回復原狀態與基準。依快照補回原本沖回的非零效果，沿用規則版本、原交易歸屬時間與接替鏈。 |
| OP-24 `points.adjust` | 無。 | 用目前有效金額沖回原交易。已沖回時跳過。 |
| OP-25 `points.apply_rule` | 無。 | 同 OP-24。規則金額與是否停用皆不影響沖回。 |
| OP-26 `tx.correct` | 根交易在原更正之後，依班級序號查無後續更正或沖回。 | 寫一筆反向更正，沿用根交易的歸屬時間與累計加分口徑，理由加上「撤銷」前綴。原更正為零元備註時照樣寫零元反向更正。 |
| OP-28 `payroll.run` | 無。 | 依原收據逐筆以現值沖回，含零元。結束連著的有效效果，快照記沖回前的有效金額。已沖回者跳過，金額改過或已沖回者帶提示。 |
| OP-30 `duty.pay` | 無。 | 同 OP-28。同一天可重新發放已沖回的薪資。 |
| OP-31 `shop.purchase` | 物品仍為 `held`。 | 依目前有效金額退點，物品改成 `returned`，商品庫存加一。物品、商品與帳戶推進版本。停用商品或轉出學生也可撤。金額改過時帶提示，改為零時寫零元沖回。 |
| OP-32 `inventory.use` | 物品仍為 `used`。 | 物品回到 `held`，對原使用交易寫零元沖回，物品與帳戶推進版本。 |

繳交撤銷的 `rev` 加一，`basis_rev` 回到原收據的 `prev_basis_rev`。撤銷新建或重新建立時，保留資料列並設成不參與、待收、基準 0，這時才會取代尚未處理的學生提議。其餘回復保留尚未處理的提議，原操作已確認或順帶取代的項目也保留原值。之後可用撤銷的 `op_id` 當 `expect.after_op`，也可用新操作重做。撤銷本身不可再撤。

繳交的扣分只按原收據處理。先沿接替鏈沖回原本新增且仍有效的效果，金額以現值為準，含零元。再依快照補回原本沖回且金額非零的效果，沿用接替鏈、規則版本、原交易理由與歸屬時間。每日任務項目從兩份反做清單略過，繳交回復後直接按截止日與現行規則重判。達標且沒有有效獎勵時補發，包含曾被單獨沖回的獎勵。舊版點收過的日子照常帶 `LEGACY_DAY_NO_DAILY_QUEST`。

訂正撤銷按原收據恢復狀態，回復前先完成所有預檢。每列 `rev` 加一、`last_op_id` 記撤銷操作，`basis_rev` 回到原收據的 `prev_basis_rev`。收據依寫入順序列出各輪的 `status` 前後值及版本，有交易再附帳戶。回復後可用撤銷的 `op_id` 作為 `expect.after_op`。OP-23 與 OP-52 即使成立為 `noop`，仍不可撤銷。

小野暫緩批次的成員還在等候確認時，老師與小野對該成員送 OP-50 都回 `NOT_UNDOABLE`。確認後成立的成員，小野可撤自己的，老師可撤本班的。處理小野批次的 OP-16 與 OP-17 本身皆不可撤。已處理的待確認項目再次收到 OP-16 或 OP-17 時回 `CONFIRMATION_NOT_PENDING`。

### 撤銷收據

- 每筆成立的撤銷都含 `result.undo`，鍵為 `target_op_id`、`skipped`、`amount_changed`。原操作未改資料，或 OP-24、OP-25、OP-28、OP-30 的交易都已沖回時，撤銷成立並取得 `class_seq`，`result.noop` 是 true，`changes` 與新交易均為空。
- OP-31 的 `changes` 依序是 `inventory_item`、`product`、`account`。OP-32 依序是 `inventory_item`、`account`。物品的前後值只列 `status`，商品只列 `stock`。OP-26 只列帳戶。
- 原交易或效果已沖回而跳過，或以改過的金額沖回時，逐筆加上 `UNDO_EFFECT_MANUALLY_CHANGED`。物件有 `code`、`case`、`effect_id`、`lineage_id`、`transaction_id`、`changed_by_op_id`、`original_amount`、`amount`。純交易的效果與接替鏈編號為 null。
- `case: already_reversed` 帶原操作記的根交易編號、執行沖回的操作編號及 `amount: null`。效果已接替時，取接替鏈最後一筆效果的沖回者，順序依建立該效果的班級序號，沒有建立操作的歷史效果排最前。
- `case: amount_changed` 帶實際被沖回的根交易編號、該根交易最後一筆更正的操作編號及本次沖回前的有效金額。補回時金額已不同、而這筆根交易沒有更正時，`changed_by_op_id` 為 null。原操作記的效果金額，或純交易的根交易金額，放在 `original_amount`。
- `result.undo.skipped` 和 `result.undo.amount_changed` 分別收錄上述兩種物件，省略 `code` 與 `case`。提示及這兩個陣列省略理由、規則名稱與操作者編號。撤銷的效果與新交易照常列在 `result`，交易依寫入順序。
- OP-28、OP-30 的撤銷不受學生轉出或職務停用影響，`changes` 只列帳戶，每位學生合併為一項並依學生編號排序。效果快照的規則欄位為 null。兩種改動提示的 `effect_id` 與 `lineage_id` 都是 null，`transaction_id` 是原薪資交易編號。

`UNDO_CONFLICT` 的 `current` 依原因回傳下列欄位。小野的 `actor` 只帶 `kind`。

| `reason` | `current` 的其餘欄位 |
|---|---|
| `basis_changed` | `value`、`rev`、`basis_rev`、`last_op_id`、`actor`、`committed_at`。繳交的 `value` 是狀態及是否參與。訂正的 `value` 是 `status`、`round`、`due_on`、`overdue_on`，另帶阻擋回復的 `correction_id`。 |
| `open_round_exists` | 同訂正的 `basis_changed`，指向另一未結束的輪次。 |
| `effect_already_active` | 同對應實體的 `basis_changed`，另帶阻擋補回的有效 `effect_id`。 |
| `tx_changed_later` | `transaction_id`、`effective_amount`、`reversed`，以及最後更正或沖回的 `last_op_id`、`actor`、`committed_at`。 |
| `item_state_changed` | `value`（只有 `status`）、`rev`、`last_op_id`、`actor`、`committed_at`。 |

## 整批撤銷 OP-51

`batch.undo` 只供老師呼叫，屬累加型，禁帶頂層 `expect`。輸入只有非空字串 `payload.batch_id` 與 1 至 50 的整數 `payload.expect_op_count`。通過共用角色及班級狀態檢查後，依序驗輸入、查本班呼叫紀錄及新成員（`NOT_FOUND`）、查是否已有成立的整批撤銷（`ALREADY_UNDONE`），再核對筆數（`STALE_STATE`，`current` 為 `{ "op_count": 實際筆數 }`）。

成員依 `agent_calls.entries` 的 `is_new` 查找。已成立的同值操作、由老師確認後才成立的操作、以及小野自己的撤銷都計入筆數。暫緩或拒絕的成員不計。外層成立後佔用整批撤銷名額，拒絕不佔用。

成立成員按 `class_seq` 由大到小各走一次 OP-50。內部操作的操作者與時間沿用 OP-51，`batch_id` 是 OP-51 的 `op_id`，`payload` 只有 `target_op_id`。內部定案拒絕保留收據，不佔用單筆撤銷名額，老師可在排除原因後分別重送 OP-50。內部編號已被占用或其他未預期例外會回復外層與所有內部操作。外層序號排在成立的內部撤銷之後。OP-51 與內部 OP-50 都不可再撤。

內部編號用 `ppt.batch_undo_op_id` 產生，命名空間固定為 `7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8`，名稱是 `batch.undo:<OP-51 op_id>:<目標 op_id>`。`ppt.uuid_v5` 把命名空間的 16 個位元組接上 UTF-8 名稱，以 PL/pgSQL 算 SHA-1，取前 16 個位元組並設版本為 5、變體高兩位為二進位 10，格式為小寫含連字號。第一次正式寫入後應固定命名空間及名稱格式。

外層 `changes` 為空。內部寫入的交易及效果記在各自的收據。外層 `result` 保留四個鍵，無內部撤銷實際改資料時 `noop` 為 `true`。新增 `result.batch` 為 `{ "batch_id", "op_count" }`，`result.items` 先列成立成員（處理順序），再列其餘成員（原清單順序）。

| 成員結果 | `result.items` 項目 |
|---|---|
| 內部撤銷成立 | `{ "target_op_id", "outcome": "undone", "undo_op_id" }` |
| 內部撤銷拒絕 | `{ "target_op_id", "outcome": "skipped", "undo_op_id", "code", "current" }`，只有內部收據含 `current` 時才帶上。後續改寫、作業或學生無效、先前已撤銷、目標本身是撤銷等皆沿用 OP-50 的結果。 |
| 原成員未成立 | `{ "target_op_id", "outcome": "skipped", "undo_op_id": null, "code": "NOT_UNDOABLE" }` |

外層 `warnings` 合併內部的 `UNDO_EFFECT_MANUALLY_CHANGED`，每項另帶 `target_op_id`。已成立的 OP-51 同編號同內容重送回原收據。

## 規格 16.2 與 16.3 的撤銷驗收

以下測試都透過 `useTestDatabase`，每支結束後比對帳戶與交易加總，並查不參與的繳交是否留下有效的遲交或缺交效果。

| 規格 | 測試檔 | 測試名稱 |
|---|---|---|
| 16.2 S1 | `undo-acceptance.test.js` | S1 連續撤銷先補回接替效果，再沖回該效果並回到原點 |
| 16.2 S2 | `batch-undo-acceptance.test.js` | S2 同批缺交再補交，倒序撤銷逐步回復基準與餘額 |
| 16.2 S3 | `undo-acceptance.test.js` | S3 兩次補交各自保留前基準，撤銷三筆後回到原點 |
| 16.2 S4 | `undo-submission-flow.test.js` | S4 缺交不再參與後重新發獎，新獎勵另起接替鏈 |
| 16.2 S5 | `legacy-effect-acceptance.test.js` | S5 補交後裁決會擋撤銷，改缺交退舊分並扣現行金額 |
| 16.2 S6 | `correction-round-contract.test.js` | S6 與 16.3 第 5 條逐步驗收，第一輪確認受阻時保留獎勵且可用新編號重撤 |
| 16.2 S7 | `daily-quest.test.js`、`undo-submission-flow.test.js` | S7 兩份準時後改缺交再改遲交，各步餘額及帳戶合併正確。S7 兩份作業分別撤銷，直到兩份都準時才補發一次。 |
| 16.3 第 1 條 | `undo-effects.test.js` | 16.3 第 1 條撤補交後人工已退缺交，撤缺交只回復狀態 |
| 16.3 第 2 條 | `undo-effects.test.js` | 16.3 第 2 條依快照補回改過的扣分，再按補回金額結束接替鏈 |
| 16.3 第 3 條 | `undo-acceptance.test.js` | 16.3 第 3 條回到同值仍有新基準，不能撤第一筆缺交 |
| 16.3 第 4 條 | `undo-submission-flow.test.js` | 16.3 第 4 條 S4 結尾重建成 %s |
| 16.3 第 5 條 | `correction-round-contract.test.js` | S6 與 16.3 第 5 條逐步驗收，第一輪確認受阻時保留獎勵且可用新編號重撤 |
| 16.3 第 6 條 | `batch-undo-acceptance.test.js` | 16.3 第 6 條第二筆沖回失敗使整批回復，同編號重送只成立一次 |
| 16.3 第 7 條 | `undo-effects.test.js` | 16.3 第 7 條撤遲交按改過的金額沖回，後續撤更正被擋 |
| 16.3 第 8 條 | `undo-submission-flow.test.js` | 16.3 第 8 條不參與繳交以 rev %i 重建為準時 |
| 16.3 第 9 條 | `undo-effects.test.js` | 16.3 第 9 條恢復作業後能撤缺交，作廢已退的扣分只提示 |
| 16.3 第 10 條 | `batch-undo-acceptance.test.js` | 16.3 第 10 條跳過小野的撤銷本身與已撤銷原操作 |

## 03:376 跨班驗收

OP-01 的來源班存取拒絕回 `CLASS_FORBIDDEN`，不登記操作。其餘十三種操作找不到本班目標時回 `NOT_FOUND`，收據省略 `current`，被引用的班級維持原值。

| 操作 | 測試檔 | 測試名稱 |
|---|---|---|
| OP-01 | `class-inherit.test.js` | 03:376 承接%s回 CLASS_FORBIDDEN 且不留資料 |
| OP-16 | `confirmation-acceptance.test.js` | %s 拒絕小野、封存班、多餘鍵與跨班目標 |
| OP-16 | `batch-undo-acceptance.test.js` | 03:376 同一老師跨班也查不到小野批次或待確認項目 |
| OP-17 | `confirmation-acceptance.test.js` | %s 拒絕小野、封存班、多餘鍵與跨班目標 |
| OP-17 | `batch-undo-acceptance.test.js` | 03:376 同一老師跨班也查不到小野批次或待確認項目 |
| OP-19 | `correction-round-contract.test.js` | 03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號 |
| OP-20 | `correction-round-contract.test.js` | 03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號 |
| OP-21 | `correction-round-contract.test.js` | 03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號 |
| OP-22 | `correction-round-contract.test.js` | 03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號 |
| OP-23 | `correction-round-contract.test.js` | 03:376 同一老師的五種訂正操作也不能跨班查找，下一輪可用別班的編號 |
| OP-26 | `transaction-acceptance.test.js` | %s查不到另一班的交易，且沒有現值 |
| OP-27 | `transaction-acceptance.test.js` | %s查不到另一班的交易，且沒有現值 |
| OP-32 | `ledger-shop-settings-acceptance.test.js` | %s 驗身分、封存、輸入鍵與跨班隔離 |
| OP-50 | `undo-contract.test.js` | 03:376 同一老師也不能跨班撤銷，原班仍可撤 |
| OP-51 | `batch-undo-acceptance.test.js` | 03:376 同一老師跨班也查不到小野批次或待確認項目 |
| OP-53 | `legacy-effect-acceptance.test.js` | 同一老師的兩個班也不能互相引用效果或交易 |

## 51 種操作的說明與驗收

| 操作 | 說明節 | 測試檔 |
|---|---|---|
| OP-01 | 建班 OP-01 | `class-create.test.js`、`class-inherit.test.js`、`acceptance-locks.test.js` |
| OP-02 至 OP-09 | 班級、學生與小組 | `class-operations.test.js`、`student-operations.test.js`、`group-operations.test.js`、`class-student-group-acceptance.test.js` |
| OP-10 至 OP-14 | 作業與規則操作 | `tasks.test.js`、`task-void.test.js`、`submission-matrix.test.js`、`schoolwork-acceptance.test.js` |
| OP-15 至 OP-17 | 學生點收與每日任務、小野的呼叫、上限與暫緩 | `submission-proposal.test.js`、`confirmation-operations.test.js`、`confirmation-acceptance.test.js`、`agent-held-confirmation.test.js` |
| OP-18 至 OP-23 | 訂正輪次 | `correction-round-start.test.js`、`correction-round-operations.test.js`、`correction-round-contract.test.js` |
| OP-24 至 OP-27 | 手動規則、交易、商店與設定 | `submit.test.js`、`apply-rule.test.js`、`tx-correct.test.js`、`tx-reverse.test.js`、`transaction-acceptance.test.js` |
| OP-28 至 OP-30 | 職務、發薪、值日 | `payroll-run.test.js`、`payroll-acceptance.test.js`、`duty-operations.test.js` |
| OP-31 至 OP-34 | 手動規則、交易、商店與設定 | `shop-purchase.test.js`、`inventory-use.test.js`、`product-operations.test.js` |
| OP-35 至 OP-37 | 職務、發薪、值日 | `job-operations.test.js`、`duty-job-setting.test.js` |
| OP-38 至 OP-39 | 作業與規則操作 | `rules.test.js`、`schoolwork-acceptance.test.js` |
| OP-40 至 OP-42 | 公告與座位 | `announcement-seating.test.js`、`announcement-seating-comment-acceptance.test.js` |
| OP-43 | 手動規則、交易、商店與設定 | `setting-operations.test.js`、`duty-job-setting.test.js` |
| OP-44 至 OP-47 | 評語與系統身分 | `comment-operations.test.js`、`comment-system-operations.test.js`、`announcement-seating-comment-acceptance.test.js` |
| OP-50 | 撤銷 OP-50 | `undo-contract.test.js`、`undo-acceptance.test.js` |
| OP-51 | 整批撤銷 OP-51 | `batch-undo.test.js`、`batch-undo-acceptance.test.js` |
| OP-52 | 訂正逾期排程 OP-52 | `correction-overdue.test.js`、`correction-overdue-acceptance.test.js` |
| OP-53 | 歷史效果 | `legacy-effect-resolve.test.js`、`legacy-effect-acceptance.test.js` |

## 暫定做法

- 資料庫以 `type`、`class_id`、`payload` 與 `expect` 組成 JSONB，轉成 UTF-8 文字後計算 SHA-256。鍵順序和輸入排版不影響比對，陣列順序會影響。省略 `expect` 和傳 JSON null 在雜湊中相同。新編號若帶 `expect`，包含 JSON null，累加型驗證會拒絕。已登記的編號先走重送比對。雜湊只供資料庫使用，中繼資料與傳送路徑不參與比對。
- 老師的提交與放棄、小野的提交只接受 36 字元小寫 UUID v4。排程和系統提交接受 36 字元小寫 UUID v5，變體位須為 `8`、`9`、`a` 或 `b`。排程編號由呼叫端以班級、工作與日期計算，資料庫驗 v5 格式。系統的 OP-47 另外驗算編號與請求的對應。老師可對封存班放棄操作。鎖等待逾時由呼叫端控制。
- 只要成立就推進班級序號，包括 `noop`。版本變更的 `entity` 與 `key` 採 `account`／`{student_id}`、`submission`／`{task_id, student_id}`、`product`／`{product_id}`、`inventory_item`／`{item_id}`。
- 購買專屬檢查依次為 `ID_CONFLICT`、`PRICE_CHANGED`、`OUT_OF_STOCK`、`INSUFFICIENT_BALANCE`。幣別採 `currency` 的舊版 `tier1.rate`／`tier2.rate`，依序對應 `fish`／`cookie`，預設 100／1000，`point` 為 1。
- 小野身分集中在 `ppt.agent_actor()` 取得。若 `call_id` 或任何一筆 `op_id` 不合格式，整批回 `INVALID_OP_ID`，不保存。

- 新建作業與規則的實體編號使用小寫 UUID v4。既有目標查找採本班的非空文字編號，OP-38 可存檔與重新啟用匯入的規則。日期必須是有效的 `YYYY-MM-DD`，截止日可早於發布日。學期依發布日，8 月到隔年 1 月是上學期，2 至 7 月是下學期。
- 省略指派名單時，只取 `enrolled`。明列名單可含 `home_study`，名單不可空或重複。自動免交以非空關鍵字比對標題子字串，忽略大小寫，類型須完全相同。指派名單在建立時固定，類型接受非空字串。
- `page_text` 可傳 JSON null 以清除頁碼，其他選填欄位以省略表示未提供。規則存檔每次帶完整內容。規則名稱為 1 至 100 字，金額為絕對值不超過 100000 的整數，允許 0。手動規則禁止傳 `event`，事件規則的代號固定為 `submission.late`、`submission.missing`、`daily_quest.complete`、`correction.confirmed`、`correction.overdue`。
- 規則的新建版本條件不符時，`current.rev` 是 0。改種類、改事件或與另一條啟用事件規則重複時，版本檢查後回 `INVALID_PAYLOAD`。同內容且仍啟用的規則存檔、重複停用、重複作廢及同值更新在版本相符時回 `noop`。用現行版本存檔停用規則會重啟並新增版本。
- 作廢沖回依學生編號及事件排序，包含轉出或封存學生的有效效果。作廢與恢復保留繳交的版本及基準，也不觸發每日任務判定。作廢選沖回時，略過未裁決的歷史效果，在收據列出這些效果並帶提示。

- OP-25 版本不符只回現行版本號與金額。提示取最近 10 分鐘內另一位操作者對同班、同學生與同規則最後一筆 `adjust`；這筆交易後續被更正或沖回也計入提示。
- OP-26 和 OP-27 都拒絕孤立更正、期初調整及原金額為零的使用道具交易。OP-27 也拒絕新版購買及有效金額為零的根交易。系統因狀態變更而結束效果時，仍照規格寫零元沖回。既有已沖回交易優先於有效金額過期回 `TX_ALREADY_REVERSED`。兩種操作都不檢查學生在學狀態、不推進繳交版本，也不重判每日任務。
- 更正的新金額限正負 100000 內的整數，理由至多 100 字。省略理由或只有空白時，以「更正」加根交易理由。零差額需有理由才寫更正交易。沖回連到有效效果時會保存規則、有效金額與歸屬時間快照，已配對的歷史效果之規則欄位為 null。購買與用道具的更正或沖回不計累計加分。更正及沖回允許餘額為負。
- 商品名稱長度為 1 至 100 字，價格、庫存及初始庫存限 0 至 100000 的整數，單位限 `point`、`fish`、`cookie`。圖示與說明選填，省略時存空值。已存在的商品可用匯入編號。使用道具只驗物品狀態，學生轉出與商品停用不影響已持有物品。
- 設定逐鍵保存並控管版本，只驗新送的值。更新幣別影響後續購買，歷史交易保留原值。
- 更正、沖回與補回交易的學期沿用其歸屬時間。匯入交易保留匯入結果。撤銷較晚的更正會寫一筆新的反向更正，因此較早的更正仍回 `tx_changed_later`。老師要再調整時用 OP-26。
- 撤銷回到仍參與且非待收的繳交時，尚未處理的提議保留。若老師試著確認，會回 `INVALID_TRANSITION`，可用 OP-17 退回。
- OP-18 建立的 `correction_id` 與 OP-21 的 `next_correction_id` 須為小寫 UUID v4。查找既有作業、學生或訂正時接受非空文字編號。輪次從 1 起，每次取同學生同作業的最大輪次加一，含取消及撤銷後保留的列。
- 訂正期限接受有效的 `YYYY-MM-DD` 或 JSON null，日期可早於當日或作業截止日。選填期限省略視為 null。`note` 限 100 字，省略、JSON null 或全空白時存 null。OP-19 至 OP-23 必須帶 `rev` 或 `after_op` 擇一，既有輪次的 `rev: 0` 不相符。OP-18 與 OP-52 禁帶 `expect`。
- 訂正真改時推進版本與基準，撤銷時按原收據回復基準。作廢作業選沖回的範圍為作業效果。老師可用 OP-22 取消未結束的輪次並選沖回。
- OP-52 的有效輸入日期接受補跑且沒有上限，呼叫端負責選擇日期。調整寬限天數只影響後續挑選，已保存的逾期日及已成立的效果保留。
- 歷史效果的匯入形狀、檢查及收據如「歷史效果」所述。資料庫驗收以兩次提交驗證裁決與狀態變更的串接；同一 HTTP 請求承載兩筆操作由端點處理。畫面可用撤銷衝突的 `current.last_op_id` 查原操作種類。
- 職稱限 1 至 100 字，OP-35 的薪資限 0 至 100000 的整數。圖示、分類選填字串，省略時存空值。匯入薪資由匯入流程處理，`jobs.salary` 可保存 numeric。職務重新啟用時，值日設定仍須另送 OP-43。
- 指派和每日值日名單以陣列保存，寫入時查本班學生，並以整份陣列含順序比對是否同值。學生之後轉出時保留名單，發薪時才依在學狀態篩選。
- 薪資期別、歷史期別旗標、收據與已知限制依「職務、發薪、值日」。事件列舉中的 `payroll`、`duty_pay` 留給效果表，OP-38 與規則表各自限制事件規則只能使用既有五種事件。
- 第 8 包的暫定做法 94 至 112 詳見「小野的呼叫、上限與暫緩」及「整批撤銷 OP-51」。10 分鐘的人數不含老師確認後才成立的操作，OP-51 至少要求一筆已成立操作。
- 第 8 包的暫定做法 113 沿用 10 分鐘人數視窗，小野可分多次逐步影響全班。小野入口沒有放棄程序。跨午夜時，輸入與金額上限用同一次呼叫的臺灣日期。異班並行使用同一 `call_id` 時，較晚寫入者可能撞主鍵而整次回復，再送回 `CALL_ID_REUSED`。

- 第 9 包甲段的暫定做法 114 至 120、133 與相關的 134 依「班級、學生與小組」。轉換器的 `classes.teacher` 對應操作的 `teacher_name`。轉換器以 JSONB 保留舊頭像，OP-05 的新輸入限字串或 JSON null。
- 第 9 包乙段依暫定做法 114、121 至 126、133 及相關的 134，見「公告與座位」及「評語與系統身分」。系統身分的存取依班級是否存在，實際套用範圍依同班且已成立的產生請求。

- 第 9 包丙段依暫定做法 127 至 132，用建班排隊鎖處理新班、共用登記與重送程序、保留定案拒絕，並在來源班的共用列鎖內承接。預設值、可承接範圍及收據見「建班 OP-01」。
- 暫定做法 133 定義收據的新建與同值格式，OP-40 整份列出四個欄位。暫定做法 134 依各操作的資料保留與版本規則處理。

## 角色與權限

| 角色 | 資料庫內的權限 |
|---|---|
| `ppt_owner` | 擁有 `ppt`、`ppt_agent` 與其中的表、型別和函式。以此身分安裝 SQL，三個寫入入口也以此身分執行。 |
| `ppt_web` | 有 `ppt` 的 USAGE 和全部表的 SELECT。老師、排程與系統透過網站後端共用此角色，寫入只經 `ppt.submit_operation` 和 `ppt.cancel_operation`。 |
| `ppt_agent` | 有 `ppt_agent` 的 USAGE，可執行 `ppt_agent.agent_submit` 與 `ppt_agent.mask_student_names`，可 SELECT 下列十七個檢視表。底層 `ppt` 的 schema、表與函式均不開放。 |
| `ppt_backup` | 有兩個 schema 的 USAGE 和 `ppt` 全部表的 SELECT。`ppt_agent` 內無物件讀取權，兩個 schema 均無寫入權和入口執行權。 |

三個連線角色均無資料表或欄位的寫入授權，也無表的 REFERENCES、TRIGGER 權限。PUBLIC 對兩個 schema 均無權限，也無其中函式的執行權。`ppt_owner` 日後建立的函式預設不開放給 PUBLIC，新建表也不會自動授予三個連線角色。

以下三支是以擁有者身分執行的函式（`SECURITY DEFINER`）。

- `ppt.submit_operation(jsonb, jsonb)` 與 `ppt.cancel_operation(text, text, jsonb)` 開放給 `ppt_web`。
- `ppt_agent.agent_submit(text, text, jsonb, text)` 開放給 `ppt_agent`，呼叫內部的 `ppt.agent_submit` 並原樣回傳結果。

網站後端用 `ppt.can_access_class(text, jsonb)` 在送出、放棄與查詢前檢查班級存取權。該函式會呼叫回傳固定身分的 `ppt.system_actor()`。這兩支輔助函式開放給 `ppt_web`，均以呼叫者身分執行。

小野的收據省略老師編號與別人輸入的自由文字。資料庫在保存收據前，將各層名為 `actor` 的物件縮成只含 `kind` 的物件。`last_op_id`、`prior_op_id` 等操作編號保留。老師確認暫緩批次時，成員仍以小野身分執行，重送會讀到已遮過的收據。

暫緩收據保留 `result.confirmation_id` 與 `result.held_reason`。`HELD_QUEUE_FULL` 與 `CALL_ID_REUSED` 仍回 `call_id`、`status: retry`、`code`。這三種收據都省略 `current`。小野從 `ppt_agent.confirmations` 查待確認筆數、從 `ppt_agent.agent_calls` 查原呼叫內容，並從 `ppt_agent.held_batches` 查自己的暫緩批次。

OP-01 建班與承接班在建立擁有者資料時一併寫入排程授權。1D 匯入完成後、開啟排程前，由管理連線以 `ppt_owner` 身分執行 [排程授權補登](maintenance/backfill-scheduler-authorizations.sql)（T-613）。這支檔只補缺少的排程授權。啟用小野時，由管理連線以 `ppt_owner` 身分逐班授權。以下兩段 SQL 的 `$1` 都綁定班級編號。

```sql
INSERT INTO ppt.class_authorizations (class_id, actor_kind)
VALUES ($1, 'agent')
ON CONFLICT (class_id, actor_kind) DO NOTHING;
```

```sql
DELETE FROM ppt.class_authorizations
WHERE class_id = $1 AND actor_kind = 'agent';
```

`ppt` 與 `ppt_agent` 內既有的 enum、domain 與獨立複合型別已收回 PUBLIC 的 USAGE。`ppt_owner` 日後建立的型別預設也收回這項權限。表的列型別與陣列型別沿用 PostgreSQL 對應表或元素型別的規則。

PostgreSQL 的 `pg_advisory_lock` 仍維持 PUBLIC 的預設執行權。小野的連線可能用連線層級的 advisory lock 阻塞同一個新班的 OP-01。此情況需要事先知道該班的新 UUID。

準備新叢集時，資料庫管理者先透過管理連線執行 `roles.js` 的 `ensureRoles(client)`，在交易內加鎖後套用 `cluster/roles.sql`。叢集角色要先於建庫與安裝建立，並維持 `NOLOGIN`，直到正式主機工單配置登入。建立由 `ppt_owner` 擁有的資料庫後，安裝連線以 `SET ROLE ppt_owner` 切換身分再呼叫 `install(client)`。安裝完成後以 `RESET ROLE` 回到原身分。

測試支架會收回測試庫的 PUBLIC TEMP 權限，並用獨立連線 `SET ROLE` 到受測角色。每條角色連線先驗 `current_user`，再執行查詢或呼叫入口。正式主機工單須以角色實際登入驗證小野的閒置交易與查詢逾時各 30 秒、鎖等待逾時 10 秒、最多 5 條連線，以及備份的預設唯讀。

正式主機工單負責配置登入及連線來源，收回正式庫的 PUBLIC CONNECT 和 TEMP，並按規格 2.1 驗證作業系統執行身分隔離及網站連線設定的存取權。須通過上線驗證後，才能在正式資料庫安裝並開放寫入入口。

### 小野的檢視表

查詢時加上 `ppt_agent.` 前綴，例如 `ppt_agent.students`。十七個檢視表都使用 `security_barrier`，只列在 `ppt.class_authorizations` 有 `actor_kind = 'agent'` 授權列的班級。歸檔班也依授權列判斷，撤回授權後該班的資料不再出現。

| 檢視表 | 可讀資料與額外篩選 |
|---|---|
| `classes` | 班級編號、狀態、成立序號，以及依序號取最後一筆成立操作的時間。 |
| `students` | 學生編號、座號、小組鍵、在學狀態，涵蓋四種在學狀態。 |
| `groups` | 小組鍵、組名與組長學生編號。小組鍵與 `students` 使用相同的名單遮罩。 |
| `accounts` | 每位學生的餘額與累計加分。 |
| `transactions` | 學生、交易種類、金額、累計加分變動、交易與生效時間、學期、相關編號，以及交易當時的規則版本名稱。沒有規則時名稱為空值。 |
| `rules` | 每條規則的種類、事件、停用狀態與現行版本。 |
| `rule_versions` | 每條規則的全部版本及其名稱、金額、圖示、分類與生效時間。 |
| `tasks` | 作業標題、類型、頁碼文字、發布日期、繳交期限、學期與作廢旗標。 |
| `submissions` | 只列 `assignment_active` 為真的繳交列，附狀態、版本、最後操作編號與該生該作業是否有未裁決的歷史效果。 |
| `corrections` | 訂正對象、輪次、狀態、日期、備註與版本。 |
| `jobs` | 職務職稱、薪資、圖示、發薪週期、分類與停用狀態。 |
| `job_assignees` | 依原指派順序逐人列出職務成員，位置從 1 起，保留已轉出學生。 |
| `daily_duties` | 依原名單順序逐人列出各日期的值日生，位置從 1 起，保留已轉出學生。 |
| `confirmations` | 學生提議與小野暫緩兩種待確認項目，附狀態、時間、對象座號及提議狀態或批次編號。 |
| `held_batches` | 只列小野被暫緩的批次，保留輸入與說明，依提交順序列出新成員的操作編號、現況、結果碼與收據。 |
| `operations` | 小野自己的操作可讀全文。別人的只列已成立操作，顯示班級與操作編號、操作者種類、操作種類、成立序號、成立時間及單一對象座號。 |
| `agent_calls` | 小野的呼叫編號、時間、說明、暫緩輸入及依原順序列出的操作編號與新成員旗標。 |

姓名遮罩使用同班四種在學狀態的名單，包含已轉出與封存的學生。姓名會比對完整姓名、三字以上去掉第一字的寫法，以及四字以上取最後兩字的寫法。比對時忽略大小寫及姓名字元間的空白，包括半形空白、全形空白與定位字元。較長的寫法優先，單趟掃描原文，保留比對範圍外的文字與空白。

單一命中換成「N號」。兩位或三位撞名時依座號由小到大排列，以「或」連接。空座號寫為「座號未定」並排在最後。四位以上換成「某位同學」。空值文字仍回空值，空名單保留原文。名單格式不合法或遮罩發生例外時，回固定字串「（遮罩失敗）」。

十種套用遮罩的文字為作業標題、頁碼文字、訂正備註、規則名稱、職務職稱、小組名稱，以及作業類型、分類、圖示和小組鍵。後四種也允許老師輸入任意文字。規則名稱涵蓋現行規則、歷史版本與交易顯示的規則名。分類、圖示涵蓋規則版本與職務，小組鍵涵蓋學生與小組檢視表。

訂正備註只有在同班有一筆已成立、由小野送出、且訂正編號相同的 OP-18 時才保留原文。老師提交及匯入的備註套用姓名遮罩。小野讀回自己寫入的原文時，無法從遮罩結果推知該姓名是否在班上。

遮罩可能漏掉綽號、只寫姓、錯字、兩字姓名的單字簡稱，以及取用的字不符合上述三種寫法的稱呼。完整的一字姓名也會比對，常用字可能連同無關文字被換掉。姓名的末兩字恰好是常用詞時也可能多遮，規則名稱換成座號後有時會較難閱讀。

## 未實作清單

| 鍵 | 缺少的分支 | 補上的分包 |
|---|---|---|

九包都已完成。正式資料庫的安裝須等資料庫角色與權限工單和規格 2.1 的上線前提完成。

## 安裝與驗證

`install(client)` 用傳入的 pg 連線，按檔名順序套用 `sql/` 內的 SQL。對新資料庫安裝時，呼叫端可包在一個交易裡提交。

測試以 `PPT_TEST_DATABASE_URL` 提供本機 PostgreSQL 16 連線資料，在儲存庫根目錄執行 `npx vitest run`。各資料庫測試檔建立並清理自己的測試資料庫。未設定該變數時，資料庫測試會略過。
