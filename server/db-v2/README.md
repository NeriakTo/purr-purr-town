# 改版資料庫寫入程序

第 1 包提供老師的手動點數調整（OP-24）、商店購買（OP-31）、操作重送與放棄，以及老師和小野共用的繳交狀態變更（OP-14）。第 2 包甲段新增作業建立、更新、作廢與恢復（OP-10 至 OP-13），以及規則存檔與停用（OP-38、OP-39）。第 2 包乙段補上每日任務獎勵、學生點收提議及其確認與退回（OP-15 至 OP-17）。第 3 包新增手動規則套用、更正與沖回、道具使用、商品存檔與停用及設定存檔。第 4 包加入撤銷（OP-50）。第 5 包加入訂正輪次（OP-18 至 OP-23）、五種訂正操作的撤銷及逾期排程（OP-52）。第 6 包加入歷史效果裁決（OP-53）、繳交限制及作廢沖回提示。資料表和函式位於 `ppt`。操作規格見 [v0.4 總則](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md)、[操作與點數](../../docs/revamp/operation-contract/02-操作規格-v0.4-操作與點數.md) 與 [連線、讀取與未決事項](../../docs/revamp/operation-contract/03-操作規格-v0.4-連線讀取與未決.md)。

## 資料表

| 表 | 用途與約束 |
|---|---|
| `classes` | 班級狀態、版本及從 0 起算的 `class_seq`。序號是提交游標，推進序號時班級資料的版本與最後改動者維持原值。 |
| `class_ownership` | 班級與老師的對應，每班一位擁有者。 |
| `class_authorizations` | 以班級與身分種類為鍵，保存小野與排程授權。測試由 SQL 建立授權列。 |
| `operations` | 以全庫唯一的 `op_id` 保存操作者、輸入、內容雜湊、狀態和收據。`recorded_at` 記登記時間。只有成立的操作有 `class_seq` 與 `committed_at`。`operations_one_committed_undo` 是部分唯一索引，只收成立的 `op.undo`，鍵是 `class_id` 與 `payload->>'target_op_id'`。 |
| `students` | 以班級與學生編號為鍵，保存座號、姓名、小組、在學狀態及版本。`exempt_rules` 預設為空陣列，每項有 `keyword` 與 `taskType`。 |
| `accounts` | 每位學生一列，保存餘額、累計加分及版本。每寫一筆交易，帳戶版本加一並更新 `last_op_id`。 |
| `transactions` | 以班級與交易編號為鍵的存摺。來源與操作／轉換批次的關係由資料庫檢查，每筆根交易至多沖回一次。觸發程序擋下更新、刪除及清空。規則產生的交易記 `rule_id` 與 `rule_rev`。程序依 `effective_at` 的臺灣日期填 `semester`，無歸屬時間時留空。撤銷補回的根交易另記 `restored_from_transaction_id`，指向快照記下的原根交易。 |
| `rules`、`rule_versions` | 規則的 `rev` 指向現行版本。每班每個事件至多一條啟用規則，已發行的版本只能新增。建立規則與首版、調整現行版本與新增版本均須在同一交易完成。 |
| `effects` | 記學生、事件、對象、規則版本、根交易、來源、接替鏈及產生／沖回的操作。未裁決和裁決為未扣分的歷史效果，事件與根交易為空。候選交易可另記在 `suggested_transaction_id`，供畫面排序。同一班內，同一學生同一事件同一對象、同一接替鏈，各至多一筆有效效果。 |
| `tasks`、`submissions` | 作業列存標題、類型、可空的頁碼文字 `page_text`、發布日、截止日、學期及作廢狀態。繳交以班級、作業、學生為鍵，含狀態、版本、基準、是否參與及匯入時的狀態。 |
| `confirmations` | 保存 `leader_proposal` 與預留的 `agent_held`。項目有作業、學生、提議狀態、建立及處理操作與時間，以及 `rev`、`last_op_id`。狀態是 `pending`、`confirmed`、`rejected` 或 `superseded`。部分唯一索引限制同一班、同一筆繳交最多有一筆尚未處理的 `leader_proposal`。 |
| `corrections` | 每輪一列，以班級與 `correction_id` 為主鍵，外鍵指向本班作業及學生。保存 `round`、`status`、可空的 `due_on`、`note`、`overdue_on` 及版本欄位。同班、同作業、同學生的輪次唯一，另有部分唯一索引保證至多一列為 `required` 或 `returned`。`basis_rev` 介於 0 和 `rev` 之間，基準為 0 時狀態須為 `cancelled`。 |
| `products`、`inventory_items` | 商品列存價格、單位、庫存、可空的 `description` 及停用狀態。背包物品記購買時的名稱、圖示、購買交易編號及物品狀態。 |
| `settings_entries` | 以班級與設定鍵定位一筆 JSONB 設定。購買使用 `currency`。 |

所有編號用 `text`，可容納匯入的 64 字元編號。版本列預設 `rev = 1`、`last_op_id = NULL`。

效果的交易關聯與背包的購買交易關聯由寫入程序建立。存摺的清空保護沿用追加寫入觸發程序。

## 入口

- `ppt.submit_operation(op jsonb, actor jsonb) RETURNS jsonb` 接收含 `class_id` 的單筆操作。操作使用 `op_id`、`type`、`payload`，選填 `expect`、`batch_id`、`client_time`、`client_seq`。接受老師 `{"kind":"teacher","id":"<老師編號>"}`，以及 `ppt.scheduler_actor()` 回傳的固定排程身分 `{"kind":"scheduler","id":"scheduler"}`。排程須有該班的 `scheduler` 授權列。
- `ppt.cancel_operation(class_id text, op_id text, actor jsonb) RETURNS jsonb` 只接受老師，登記放棄或回原收據。放棄新編號時，操作紀錄的 `type`、`payload`、`expect` 及內容雜湊皆為空。
- `ppt.agent_submit(class_id text, call_id text, ops jsonb, note text) RETURNS jsonb` 接收 1 到 50 筆操作。資料庫填入固定的小野身分、外層班級及批次編號。入口持有整批班級鎖，只在取得鎖時重驗一次授權，按輸入順序逐筆執行。每筆各有儲存點，定案拒絕保留該筆的操作紀錄，未預期例外使整次呼叫回復。
- `ppt.submit_locked_operation(p_op jsonb, p_actor jsonb) RETURNS jsonb` 是內部共用入口。外層須先驗信封、授權、編號、隔離層級，並持有已重驗授權的班級鎖。批次呼叫者可在同一交易逐筆使用。

各入口要求 `read committed`，其他隔離層級拋出 `25000`。入口由呼叫端提交或回復，班級鎖持有到該交易結束。每筆操作在持有班級鎖時取一次 `clock_timestamp()`，共用於該筆操作與它產生的交易。

## 收據

不保存的單筆結果固定為 `{ "op_id": "…", "status": "retry", "code": "…" }`。沒有字串形式的編號時，`op_id` 為 JSON null。小野入口的整批檢查失敗回 `{ "call_id": "…", "status": "retry", "code": "…" }`，通過時回 `{ "call_id": "…", "receipts": […] }`，陣列元素是逐筆收據，允許混有單筆的 `retry`。

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
- `setting` 以 `{key}` 定位設定列，前後值各為 `{"value": 設定值}`，新建的 `prev_value` 為 JSON null。
- `RULE_VERSION_STALE` 的 `current` 只有 `rev` 和 `value.amount`。OP-26、OP-27 的 `STALE_STATE` 只回根交易的 `transaction_id` 與 `effective_amount`。
- 版本列的 `STALE_STATE` 的 `current` 有 `value`、`rev`、`last_op_id`、`actor`、`committed_at`。最後改動的資料取自同班的操作紀錄。目標列不存在時，`rev` 為 0，其他欄位為 JSON null。OP-14 的版本條件通過後，若 `only_if_no_proposal: true` 擋下操作，`current.proposal` 有 `confirmation_id`、`proposed_status`、`status`、`proposed_at`，其中 `proposed_at` 是提議的提交時間。
- `warnings` 是物件陣列，每項至少有 `code`。`LEGACY_DAY_NO_DAILY_QUEST` 另有 `student_id` 與 `date`，日期是 `YYYY-MM-DD`。每日任務交易仍列入 `result.transactions`，效果清單以 `event: daily_quest.complete` 識別，`subject_kind` 是 `date`，`subject_key` 是截止日。
- OP-25 的 `POSSIBLE_DUPLICATE` 含 `code`、`student_id`、`rule_id`、`prior_op_id`、`prior_actor_kind`、`prior_at`。這項提示照樣允許成立。
- 重送讀取已保存的收據，僅將回傳的 `replayed` 設為 `true`。同編號異班、異操作者或異內容回 `OP_ID_REUSED`。同班、同操作者提交已放棄的編號時，回 `cancelled`、`OP_CANCELLED`。放棄已存在的編號時，只比班級與操作者。
- 小野目前也逐筆依 `op_id` 重播。已存在的操作保留原本的 `batch_id`。

## 檢查順序

1. 提交先檢查交易隔離層級，再驗信封。操作須為物件、有非空的字串 `class_id`，且 `payload` 以資料庫的 JSONB 文字輸出計算，最多 64 KiB UTF-8。信封不符回 `BAD_ENVELOPE`。
2. 單筆提交與放棄先驗傳入身分，無效身分拋出 `22023`，系統身分走未實作分支。小野入口先檢查整批信封和重複編號。接著驗班級存取權及編號格式，鎖住班級列後再驗一次存取權。班級不存在或無存取權都回 `CLASS_FORBIDDEN`，編號不符回 `INVALID_OP_ID`。這兩種回應都不登記操作。
3. 登記編號。主鍵處理跨班同編號競爭。已有編號時依重送規則比對，內容衝突回 `OP_ID_REUSED`。
4. 新操作依序檢查 `UNKNOWN_OP_TYPE`、`FORBIDDEN_ROLE`、`CLASS_ARCHIVED`、輸入的 `INVALID_PAYLOAD`、小野的 `SCOPE_FORBIDDEN`、`NOT_FOUND`、`ENTITY_INACTIVE`、`INVALID_TRANSITION`、`STALE_STATE`、各操作專屬檢查。專屬檢查若有 `ID_CONFLICT`，排在其餘專屬檢查之前。OP-50 查到原操作後依撤銷一節的順序檢查。目前辨識 OP-10 至 OP-27、OP-31 至 OP-34、OP-38、OP-39、OP-43、OP-50、OP-52 與 OP-53。小野可呼叫 OP-14、OP-18、OP-19、OP-25 與 OP-50，撤銷限自己的操作。排程只可呼叫 OP-52。
5. 套用操作後，推進 `class_seq` 並保存收據。OP-24 的金額是非零整數，絕對值至多 100000，理由至多 100 字，省略或空白時存「手動調整」。帳戶可為負值，這筆交易的 `earned_delta` 等於 `amount`。

OP-14 接受 `expect.rev` 或同班且已成立的 `expect.after_op`。不存在或不參與的列接受 `rev: 0`；重新建立不參與的列會推進版本並重設基準。改成補交時保留作業扣分效果。其他狀態依現存效果沖回或新增。沖回採根交易的有效金額與原歸屬時間，包含 0 元沖回。版本通過後先檢查 `only_if_no_proposal`，再判斷同值與未裁決歷史效果。同值成立時保留待確認提議，真正改動才取代提議。

OP-31 檢查新物品編號、價格、庫存與餘額後，在同一交易扣款、建立背包物品及扣庫存。購買金額只計入餘額。

操作檢查或寫入要定案拒絕時，呼叫 `ppt.reject_operation(p_code ppt.operation_code, p_current jsonb DEFAULT NULL)`。這支函式使用 SQLSTATE `P604R`，把規格錯誤碼放在 `MESSAGE`，選填的 `current` JSON 放在 `DETAIL`。核心只攔這個 SQLSTATE，先回復該筆的檢查與寫入區塊，再把拒絕收據存進已登記的操作列。其他例外往外拋。偵測到已標記的未實作分支時，`ppt.pending_operation(p_key text)` 拋出 `0A000`，`DETAIL` 為該分支鍵。

## 作業與規則操作

以下六種操作只供老師呼叫。輸入指 `payload`，表中列出完整的允許鍵。累加型禁止出現 `expect` 鍵。設定型必須帶 `{"rev": 整數}` 或 `{"after_op": "前一筆操作編號"}` 其中一種。

| 操作 | `expect` | 輸入 | 目標檢查與成立結果 |
|---|---|---|---|
| OP-10 `task.create` | 禁帶 | `task_id`、`title`、`task_type`、`published_on`、`due_on`，選填 `page_text`、`assignee_ids` | 檢查名單中查不到的學生、轉出或封存學生，再檢查作業編號是否已用過。依發布日計算學期，建立作業及名單上的繳交。符合自動免交規則的設為 `exempt`，其餘為 `pending`。兩種的版本與基準都從 1 起算。 |
| OP-11 `task.update` | 必帶 | `task_id`，以及 `title`、`task_type`、`page_text`、`due_on` 中至少一項 | 依序檢查作業存在、未作廢、版本相符。更新作業列，繳交、點數及效果原樣保留。 |
| OP-12 `task.void` | 必帶 | `task_id`、布林 `reverse_effects` | 檢查作業存在與版本。作業改成作廢。選沖回時逐筆結束有效效果，把根交易的有效金額取反寫入存摺，含零元。略過未裁決歷史效果並列在收據。繳交資料與版本原樣保留。第一次作廢會取代該作業尚未處理的全部學生提議。 |
| OP-13 `task.restore` | 必帶 | `task_id` | 檢查作業存在、目前作廢、版本相符，依序回 `NOT_FOUND`、`INVALID_TRANSITION`、`STALE_STATE`。恢復作業，繳交和點數原樣保留。 |
| OP-38 `rule.save` | 必帶，新建用 `rev: 0` | `rule_id`、`kind`、`name`、`amount`，事件規則必帶 `event`，選填 `icon`、`category` | 既有規則接受本班的非空文字編號，含匯入編號。先檢查版本，再檢查新建編號是否為小寫 UUID v4、種類或事件是否變動，以及啟用事件是否重複。改動時新增一版，於提交時間生效。儲存停用規則會重新啟用。 |
| OP-39 `rule.retire` | 必帶 | `rule_id` | 檢查規則存在與版本。停用時新增一版內容相同的版本列，已發生的交易與效果原樣保留。 |

## 學生點收與每日任務

OP-15 至 OP-17 只供老師呼叫，禁帶 `expect`。既有實體的編號以非空字串在本班查找。

| 操作 | 輸入 | 目標檢查與成立結果 |
|---|---|---|
| OP-15 `submission.propose` | `task_id`、`student_id`、`proposed_status` | 提議 `on_time`、`late`、`missing` 時，依序檢查參與中的繳交存在、作業及學生有效、繳交待收。舊資料的 `unknown` 視同待收。先取代尚未處理的提議，再以本操作的 `op_id` 建立新項目。傳 `pending` 表示收回，只檢查參與中的繳交存在，再取代尚未處理的提議。無項目可收回時 `result.noop` 為 `true`、`changes` 為空。提議與收回都保留繳交與點數。 |
| OP-16 `confirmation.confirm` | `confirmation_id` | 先檢查項目存在且尚未處理，再查作業、學生及繳交是否符合點收條件。使用 OP-14 的繳交寫入與效果流程，並在同一筆操作把提議標成已確認。 |
| OP-17 `confirmation.reject` | `confirmation_id` | 檢查項目存在且尚未處理後標成已退回，保留繳交與點數。 |

已確認、退回或被取代的項目回 `CONFIRMATION_NOT_PENDING`。尚未處理的 `agent_held` 項目會拋出未實作例外。

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
| `dutyJobId` | 拋出未實作例外，鍵為 `setting_duty_job`。 |
| `currentSemester` | JSON null，或兩至三位數年份加 `-1` 或 `-2`。 |
| `taskTypes` | 不重複的非空字串陣列。 |
| `ruleCategories` | 物件陣列。 |
| `semesterPeriods` | 各值皆為物件。有 `start` 或 `end` 時，各值須為 JSON null 或有效的 `YYYY-MM-DD` 日期。 |
| `shopMeta` | 物件。 |

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

OP-12 真的作廢且選沖回時，逐筆沖回仍有效的作業效果，依學生編號、效果編號以 `COLLATE "C"` 列出未裁決歷史效果。未裁決仍維持原狀，之後可用 OP-53 裁決。已裁決為未扣分的效果省略。選沖回的範圍依目前裁定限作業效果，訂正效果的範圍仍待專案負責人裁定。

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

匯入程序對有版本的列設 `rev = 1`、`last_op_id = NULL`。繳交另設 `basis_rev = 1`、`assignment_active = true`，把轉換出的狀態同步填入 `status` 與 `legacy_status_at_import`，之後保留匯入狀態原值。批次 `cutover_date` 會由匯入程序寫入班級，班級欄位由第 7 包建立。效果表的來源追溯資料去向由匯入工單決定。目前的驗收使用 SQL 建立上述匯入結果。

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
| OP-31 `shop.purchase` | 物品仍為 `held`。 | 依目前有效金額退點，物品改成 `returned`，商品庫存加一。物品、商品與帳戶推進版本。停用商品或轉出學生也可撤。金額改過時帶提示，改為零時寫零元沖回。 |
| OP-32 `inventory.use` | 物品仍為 `used`。 | 物品回到 `held`，對原使用交易寫零元沖回，物品與帳戶推進版本。 |

繳交撤銷的 `rev` 加一，`basis_rev` 回到原收據的 `prev_basis_rev`。撤銷新建或重新建立時，保留資料列並設成不參與、待收、基準 0，這時才會取代尚未處理的學生提議。其餘回復保留尚未處理的提議，原操作已確認或順帶取代的項目也保留原值。之後可用撤銷的 `op_id` 當 `expect.after_op`，也可用新操作重做。撤銷本身不可再撤。

繳交的扣分只按原收據處理。先沿接替鏈沖回原本新增且仍有效的效果，金額以現值為準，含零元。再依快照補回原本沖回且金額非零的效果，沿用接替鏈、規則版本、原交易理由與歸屬時間。每日任務項目從兩份反做清單略過，繳交回復後直接按截止日與現行規則重判。達標且沒有有效獎勵時補發，包含曾被單獨沖回的獎勵。舊版點收過的日子照常帶 `LEGACY_DAY_NO_DAILY_QUEST`。

訂正撤銷按原收據恢復狀態，回復前先完成所有預檢。每列 `rev` 加一、`last_op_id` 記撤銷操作，`basis_rev` 回到原收據的 `prev_basis_rev`。收據依寫入順序列出各輪的 `status` 前後值及版本，有交易再附帳戶。回復後可用撤銷的 `op_id` 作為 `expect.after_op`。OP-23 與 OP-52 即使成立為 `noop`，仍不可撤銷。

### 撤銷收據

- 每筆成立的撤銷都含 `result.undo`，鍵為 `target_op_id`、`skipped`、`amount_changed`。原操作未改資料，或 OP-24／OP-25 的交易都已沖回時，撤銷成立並取得 `class_seq`，`result.noop` 是 true，`changes` 與新交易均為空。
- OP-31 的 `changes` 依序是 `inventory_item`、`product`、`account`。OP-32 依序是 `inventory_item`、`account`。物品的前後值只列 `status`，商品只列 `stock`。OP-26 只列帳戶。
- 原交易或效果已沖回而跳過，或以改過的金額沖回時，逐筆加上 `UNDO_EFFECT_MANUALLY_CHANGED`。物件有 `code`、`case`、`effect_id`、`lineage_id`、`transaction_id`、`changed_by_op_id`、`original_amount`、`amount`。純交易的效果與接替鏈編號為 null。
- `case: already_reversed` 帶原操作記的根交易編號、執行沖回的操作編號及 `amount: null`。效果已接替時，取接替鏈最後一筆效果的沖回者，順序依建立該效果的班級序號，沒有建立操作的歷史效果排最前。
- `case: amount_changed` 帶實際被沖回的根交易編號、該根交易最後一筆更正的操作編號及本次沖回前的有效金額。補回時金額已不同、而這筆根交易沒有更正時，`changed_by_op_id` 為 null。原操作記的效果金額，或純交易的根交易金額，放在 `original_amount`。
- `result.undo.skipped` 和 `result.undo.amount_changed` 分別收錄上述兩種物件，省略 `code` 與 `case`。提示及這兩個陣列省略理由、規則名稱與操作者編號。撤銷的效果與新交易照常列在 `result`，交易依寫入順序。

`UNDO_CONFLICT` 的 `current` 依原因回傳下列欄位。小野的 `actor` 只帶 `kind`。

| `reason` | `current` 的其餘欄位 |
|---|---|
| `basis_changed` | `value`、`rev`、`basis_rev`、`last_op_id`、`actor`、`committed_at`。繳交的 `value` 是狀態及是否參與。訂正的 `value` 是 `status`、`round`、`due_on`、`overdue_on`，另帶阻擋回復的 `correction_id`。 |
| `open_round_exists` | 同訂正的 `basis_changed`，指向另一未結束的輪次。 |
| `effect_already_active` | 同對應實體的 `basis_changed`，另帶阻擋補回的有效 `effect_id`。 |
| `tx_changed_later` | `transaction_id`、`effective_amount`、`reversed`，以及最後更正或沖回的 `last_op_id`、`actor`、`committed_at`。 |
| `item_state_changed` | `value`（只有 `status`）、`rev`、`last_op_id`、`actor`、`committed_at`。 |

## 暫定做法

- 資料庫以 `type`、`class_id`、`payload` 與 `expect` 組成 JSONB，轉成 UTF-8 文字後計算 SHA-256。鍵順序和輸入排版不影響比對，陣列順序會影響。省略 `expect` 和傳 JSON null 在雜湊中相同。新編號若帶 `expect`，包含 JSON null，累加型驗證會拒絕。已登記的編號先走重送比對。雜湊只供資料庫使用，中繼資料與傳送路徑不參與比對。
- 老師的提交與放棄、小野的提交只接受 36 字元小寫 UUID v4。排程提交接受 36 字元小寫 UUID v5，變體位須為 `8`、`9`、`a` 或 `b`。資料庫只驗 v5 格式，呼叫端負責由班級、工作與日期計算編號。系統身分留待第 9 包。老師可對封存班放棄操作。鎖等待逾時由呼叫端控制。
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

## 未實作清單

| 鍵 | 缺少的分支 | 補上的分包 |
|---|---|---|
| `actor_system` | 系統身分入口 | 第 9 包 |
| `agent_call_record` | 呼叫紀錄、整批重播、`CALL_ID_REUSED` 與新舊分組 | 第 8 包 |
| `agent_held_confirmation` | 確認或退回小野暫緩批次 | 第 8 包 |
| `agent_limits` | 小野操作上限、整批暫緩及待確認佇列，含 OP-25 的當日重複暫緩。也含小野撤銷自己的操作所寫的交易怎麼算進上限。含小野送 OP-18、OP-19 影響的學生數。 | 第 8 包 |
| `agent_note` | 保存小野呼叫的 `note` | 第 8 包 |
| `class_create` | OP-01 在班級列尚不存在時的建班路徑 | 第 9 包 |
| `setting_duty_job` | 驗證 `dutyJobId` 指向本班職務 | 第 7 包 |
| `undo_payroll` | 撤銷發薪操作 | 第 7 包 |

第 8 包完成前，整合分支限小野無法呼叫的環境。正式資料庫的安裝須等資料庫角色與權限工單和規格 2.1 的上線前提完成。

## 安裝與驗證

`install(client)` 用傳入的 pg 連線，按檔名順序套用 `sql/` 內的 SQL。對新資料庫安裝時，呼叫端可包在一個交易裡提交。

測試以 `PPT_TEST_DATABASE_URL` 提供本機 PostgreSQL 16 連線資料，在儲存庫根目錄執行 `npx vitest run`。各資料庫測試檔建立並清理自己的測試資料庫。未設定該變數時，資料庫測試會略過。
