# 改版資料庫寫入程序

第 1 包提供老師的手動點數調整（OP-24）、商店購買（OP-31）、操作重送與放棄，以及老師和小野共用的繳交狀態變更（OP-14）。第 2 包甲段新增作業建立、更新、作廢與恢復（OP-10 至 OP-13），以及規則存檔與停用（OP-38、OP-39）。第 2 包乙段補上每日任務獎勵、學生點收提議及其確認與退回（OP-15 至 OP-17）。資料表和函式位於 `ppt`。操作規格見 [v0.4 總則](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md) 與 [操作與點數](../../docs/revamp/operation-contract/02-操作規格-v0.4-操作與點數.md)。

## 資料表

| 表 | 用途與約束 |
|---|---|
| `classes` | 班級狀態、版本及從 0 起算的 `class_seq`。序號是提交游標，推進序號時班級資料的版本與最後改動者維持原值。 |
| `class_ownership` | 班級與老師的對應，每班一位擁有者。 |
| `class_authorizations` | 以班級與身分種類為鍵，保存小野授權並預留排程授權。測試由 SQL 建立授權列。 |
| `operations` | 以全庫唯一的 `op_id` 保存操作者、輸入、內容雜湊、狀態和收據。`recorded_at` 記登記時間。只有成立的操作有 `class_seq` 與 `committed_at`。 |
| `students` | 以班級與學生編號為鍵，保存座號、姓名、小組、在學狀態及版本。`exempt_rules` 預設為空陣列，每項有 `keyword` 與 `taskType`。 |
| `accounts` | 每位學生一列，保存餘額、累計加分及版本。每寫一筆交易，帳戶版本加一並更新 `last_op_id`。 |
| `transactions` | 以班級與交易編號為鍵的存摺。來源與操作／轉換批次的關係由資料庫檢查，每筆根交易至多沖回一次。觸發程序擋下更新、刪除及清空。規則產生的交易記 `rule_id` 與 `rule_rev`。 |
| `rules`、`rule_versions` | 規則的 `rev` 指向現行版本。每班每個事件至多一條啟用規則，已發行的版本只能新增。建立規則與首版、調整現行版本與新增版本均須在同一交易完成。 |
| `effects` | 記學生、事件、對象、規則版本、根交易、來源、接替鏈及產生／沖回的操作。未裁決歷史效果的事件與根交易為空。同一班內，同一學生同一事件同一對象、同一接替鏈，各至多一筆有效效果。 |
| `tasks`、`submissions` | 作業列存標題、類型、可空的頁碼文字 `page_text`、發布日、截止日、學期及作廢狀態。繳交以班級、作業、學生為鍵，含狀態、版本、基準、是否參與及匯入時的狀態。 |
| `confirmations` | 保存 `leader_proposal` 與預留的 `agent_held`。項目有作業、學生、提議狀態、建立及處理操作與時間，以及 `rev`、`last_op_id`。狀態是 `pending`、`confirmed`、`rejected` 或 `superseded`。部分唯一索引限制同一班、同一筆繳交最多有一筆尚未處理的 `leader_proposal`。 |
| `products`、`inventory_items` | 商品列存價格、單位、庫存及停用狀態。背包物品記購買時的名稱、圖示、購買交易編號及物品狀態。 |
| `settings_entries` | 以班級與設定鍵定位一筆 JSONB 設定。購買使用 `currency`。 |

所有編號用 `text`，可容納匯入的 64 字元編號。版本列預設 `rev = 1`、`last_op_id = NULL`。

效果的交易關聯與背包的購買交易關聯由寫入程序建立。存摺的清空保護沿用追加寫入觸發程序。

## 入口

- `ppt.submit_operation(op jsonb, actor jsonb) RETURNS jsonb` 接收含 `class_id` 的單筆操作。操作使用 `op_id`、`type`、`payload`，選填 `expect`、`batch_id`、`client_time`、`client_seq`。老師身分形狀為 `{"kind":"teacher","id":"<老師編號>"}`。
- `ppt.cancel_operation(class_id text, op_id text, actor jsonb) RETURNS jsonb` 登記放棄或回原收據。放棄新編號時，操作紀錄的 `type`、`payload`、`expect` 及內容雜湊皆為空。
- `ppt.agent_submit(class_id text, call_id text, ops jsonb, note text) RETURNS jsonb` 接收 1 到 50 筆操作。資料庫填入固定的小野身分、外層班級及批次編號。入口持有整批班級鎖，只在取得鎖時重驗一次授權，按輸入順序逐筆執行。每筆各有儲存點，定案拒絕保留該筆的操作紀錄，未預期例外使整次呼叫回復。
- `ppt.submit_locked_operation(p_op jsonb, p_actor jsonb) RETURNS jsonb` 是內部共用入口。外層須先驗信封、授權、編號、隔離層級，並持有已重驗授權的班級鎖。批次呼叫者可在同一交易逐筆使用。

各入口要求 `read committed`，其他隔離層級拋出 `25000`。入口由呼叫端提交或回復，班級鎖持有到該交易結束。每筆操作在持有班級鎖時取一次 `clock_timestamp()`，共用於該筆操作與它產生的交易。

## 收據

不保存的單筆結果固定為 `{ "op_id": "…", "status": "retry", "code": "…" }`。沒有字串形式的編號時，`op_id` 為 JSON null。小野入口的整批檢查失敗回 `{ "call_id": "…", "status": "retry", "code": "…" }`，通過時回 `{ "call_id": "…", "receipts": […] }`，陣列元素是逐筆收據，允許混有單筆的 `retry`。

保存的收據有 `op_id`、`status`、`code`、`replayed`、`class_seq`、`committed_at`、`result`、`changes`、`warnings`。非成立收據的序號與提交時間為 JSON null。

- `result` 有 `noop`、`transactions`、`effects_added`、`effects_reversed`。`transactions` 依寫入順序列交易編號。兩份效果清單各記 `effect_id`、`lineage_id`、`event`、`subject_kind`、`subject_key`、`root_transaction_id`。新增附 `amount`，沖回附 `rule_id`、`rule_rev`、`effective_amount`、`effective_at`。
- `changes` 各項記 `entity`、`key`、`prev_rev`、`rev`、`prev_value`、`value`、`last_op_id`。帳戶的值包含 `balance` 與 `total_earned`，多筆交易合併為交易前與交易後的整體變更。繳交也記 `prev_basis_rev`、`basis_rev`。同值成立時收據列出當前版本及值，資料列的最後改動操作維持原值。
- `task` 以 `{task_id}` 為鍵，建立時列出作業完整值，再依座號、學生編號列出初始繳交。更新列出變動欄位，同值成立時列出提交的欄位及當前值。作廢與恢復列出 `voided`。作廢沖回時，作業變更排在前面，每位受影響學生有一項帳戶變更。
- `rule` 以 `{rule_id}` 為鍵，值含 `kind`、`event`、`disabled`、`name`、`amount`、`icon`、`category`。
- `confirmation` 以 `{confirmation_id}` 為鍵。提議新建時列出完整值，`prev_rev` 為 0、`prev_value` 為 null。取代、確認或退回時，列出狀態、處理操作及處理時間的前後值。OP-15 的 `changes` 只列實際改動的待確認項目。
- `STALE_STATE` 的 `current` 有 `value`、`rev`、`last_op_id`、`actor`、`committed_at`。最後改動的資料取自同班的操作紀錄。目標列不存在時，`rev` 為 0，其他欄位為 JSON null。OP-14 的版本條件通過後，若 `only_if_no_proposal: true` 擋下操作，`current.proposal` 有 `confirmation_id`、`proposed_status`、`status`、`proposed_at`，其中 `proposed_at` 是提議的提交時間。
- `warnings` 是物件陣列，每項至少有 `code`。`LEGACY_DAY_NO_DAILY_QUEST` 另有 `student_id` 與 `date`，日期是 `YYYY-MM-DD`。每日任務交易仍列入 `result.transactions`，效果清單以 `event: daily_quest.complete` 識別，`subject_kind` 是 `date`，`subject_key` 是截止日。
- 重送讀取已保存的收據，僅將回傳的 `replayed` 設為 `true`。同編號異班、異操作者或異內容回 `OP_ID_REUSED`。同班、同操作者提交已放棄的編號時，回 `cancelled`、`OP_CANCELLED`。放棄已存在的編號時，只比班級與操作者。
- 小野目前也逐筆依 `op_id` 重播。已存在的操作保留原本的 `batch_id`。

## 檢查順序

1. 提交先檢查交易隔離層級，再驗信封。操作須為物件、有非空的字串 `class_id`，且 `payload` 以資料庫的 JSONB 文字輸出計算，最多 64 KiB UTF-8。信封不符回 `BAD_ENVELOPE`。
2. 驗班級存取權，接著驗編號格式。鎖住班級列後再驗一次存取權。班級不存在或無存取權都回 `CLASS_FORBIDDEN`，編號不符回 `INVALID_OP_ID`。老師的提交與放棄入口另驗傳入身分，小野入口先檢查整批信封和重複編號。
3. 登記編號。主鍵處理跨班同編號競爭。已有編號時依重送規則比對，內容衝突回 `OP_ID_REUSED`。
4. 新操作依序檢查 `UNKNOWN_OP_TYPE`、`FORBIDDEN_ROLE`、`CLASS_ARCHIVED`、輸入的 `INVALID_PAYLOAD`、小野的 `SCOPE_FORBIDDEN`、`NOT_FOUND`、`ENTITY_INACTIVE`、`INVALID_TRANSITION`、`STALE_STATE`、各操作專屬檢查。專屬檢查若有 `ID_CONFLICT`，排在其餘專屬檢查之前。目前辨識 OP-10 至 OP-17、OP-24、OP-31、OP-38、OP-39。小野只允許 OP-14。
5. 套用操作後，推進 `class_seq` 並保存收據。OP-24 的金額是非零整數，絕對值至多 100000，理由至多 100 字，省略或空白時存「手動調整」。帳戶可為負值，這筆交易的 `earned_delta` 等於 `amount`。

OP-14 接受 `expect.rev` 或同班且已成立的 `expect.after_op`。不存在或不參與的列接受 `rev: 0`；重新建立不參與的列會推進版本並重設基準。改成補交時保留作業扣分效果。其他狀態依現存效果沖回或新增。沖回採根交易的有效金額與原歸屬時間，包含 0 元沖回。版本通過後先檢查 `only_if_no_proposal`，再判斷同值。同值成立時保留待確認提議，真正改動才取代提議。

OP-31 檢查新物品編號、價格、庫存與餘額後，在同一交易扣款、建立背包物品及扣庫存。購買金額只計入餘額。

操作檢查或寫入要定案拒絕時，呼叫 `ppt.reject_operation(p_code ppt.operation_code, p_current jsonb DEFAULT NULL)`。這支函式使用 SQLSTATE `P604R`，把規格錯誤碼放在 `MESSAGE`，選填的 `current` JSON 放在 `DETAIL`。核心只攔這個 SQLSTATE，先回復該筆的檢查與寫入區塊，再把拒絕收據存進已登記的操作列。其他例外往外拋。偵測到已標記的未實作分支時，`ppt.pending_operation(p_key text)` 拋出 `0A000`，`DETAIL` 為該分支鍵。

## 作業與規則操作

以下六種操作只供老師呼叫。輸入指 `payload`，表中列出完整的允許鍵。累加型禁止出現 `expect` 鍵。設定型必須帶 `{"rev": 整數}` 或 `{"after_op": "前一筆操作編號"}` 其中一種。

| 操作 | `expect` | 輸入 | 目標檢查與成立結果 |
|---|---|---|---|
| OP-10 `task.create` | 禁帶 | `task_id`、`title`、`task_type`、`published_on`、`due_on`，選填 `page_text`、`assignee_ids` | 檢查名單中查不到的學生、轉出或封存學生，再檢查作業編號是否已用過。依發布日計算學期，建立作業及名單上的繳交。符合自動免交規則的設為 `exempt`，其餘為 `pending`。兩種的版本與基準都從 1 起算。 |
| OP-11 `task.update` | 必帶 | `task_id`，以及 `title`、`task_type`、`page_text`、`due_on` 中至少一項 | 依序檢查作業存在、未作廢、版本相符。更新作業列，繳交、點數及效果原樣保留。 |
| OP-12 `task.void` | 必帶 | `task_id`、布林 `reverse_effects` | 檢查作業存在與版本。作業改成作廢。選沖回時逐筆結束有效效果，把根交易的有效金額取反寫入存摺，含零元。繳交資料與版本原樣保留。第一次作廢會取代該作業尚未處理的全部學生提議。 |
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

## 暫定做法

- 資料庫以 `type`、`class_id`、`payload` 與 `expect` 組成 JSONB，轉成 UTF-8 文字後計算 SHA-256。鍵順序和輸入排版不影響比對，陣列順序會影響。省略 `expect` 和傳 JSON null 在雜湊中相同。新編號若帶 `expect`，包含 JSON null，累加型驗證會拒絕。已登記的編號先走重送比對。雜湊只供資料庫使用，中繼資料與傳送路徑不參與比對。
- 瀏覽器與小野的編號採 36 字元小寫 UUID v4。排程與系統採 v5，外部入口收到 v5 回 `INVALID_OP_ID`。放棄允許封存班。鎖等待逾時由呼叫端控制。
- 只要成立就推進班級序號，包括 `noop`。版本變更的 `entity` 與 `key` 採 `account`／`{student_id}`、`submission`／`{task_id, student_id}`、`product`／`{product_id}`、`inventory_item`／`{item_id}`。
- 購買專屬檢查依次為 `ID_CONFLICT`、`PRICE_CHANGED`、`OUT_OF_STOCK`、`INSUFFICIENT_BALANCE`。幣別採 `currency` 的舊版 `tier1.rate`／`tier2.rate`，依序對應 `fish`／`cookie`，預設 100／1000，`point` 為 1。
- 小野身分集中在 `ppt.agent_actor()` 取得。若 `call_id` 或任何一筆 `op_id` 不合格式，整批回 `INVALID_OP_ID`，不保存。

- 新建作業與規則的實體編號使用小寫 UUID v4。既有目標查找採本班的非空文字編號，OP-38 可存檔與重新啟用匯入的規則。日期必須是有效的 `YYYY-MM-DD`，截止日可早於發布日。學期依發布日，8 月到隔年 1 月是上學期，2 至 7 月是下學期。
- 省略指派名單時，只取 `enrolled`。明列名單可含 `home_study`，名單不可空或重複。自動免交以非空關鍵字比對標題子字串，忽略大小寫，類型須完全相同。指派名單在建立時固定，類型接受非空字串。
- `page_text` 可傳 JSON null 以清除頁碼，其他選填欄位以省略表示未提供。規則存檔每次帶完整內容。規則名稱為 1 至 100 字，金額為絕對值不超過 100000 的整數，允許 0。手動規則禁止傳 `event`，事件規則的代號固定為 `submission.late`、`submission.missing`、`daily_quest.complete`、`correction.confirmed`、`correction.overdue`。
- 規則的新建版本條件不符時，`current.rev` 是 0。改種類、改事件或與另一條啟用事件規則重複時，版本檢查後回 `INVALID_PAYLOAD`。同內容且仍啟用的規則存檔、重複停用、重複作廢及同值更新在版本相符時回 `noop`。用現行版本存檔停用規則會重啟並新增版本。
- 作廢沖回依學生編號及事件排序，包含轉出或封存學生的有效效果。作廢與恢復保留繳交的版本及基準，也不觸發每日任務判定。作廢選沖回且有未裁決歷史效果時，會拋出未實作例外並回復整筆操作。

## 未實作清單

| 鍵 | 缺少的分支 | 補上的分包 |
|---|---|---|
| `actor_scheduler_system` | 排程及系統身分入口 | 第 5 包排程、第 9 包系統 |
| `agent_call_record` | 呼叫紀錄、整批重播、`CALL_ID_REUSED` 與新舊分組 | 第 8 包 |
| `agent_held_confirmation` | 確認或退回小野暫緩批次 | 第 8 包 |
| `agent_limits` | 小野操作上限、整批暫緩及待確認佇列 | 第 8 包 |
| `agent_note` | 保存小野呼叫的 `note` | 第 8 包 |
| `class_create` | OP-01 在班級列尚不存在時的建班路徑 | 第 9 包 |
| `legacy_unresolved` | 有未裁決歷史效果時，依 OP-53 與繳交限制處理 | 第 6 包 |
| `task_void_legacy_effects` | 作廢作業選沖回時，略過並回報未裁決歷史效果 | 第 6 包 |

第 8 包完成前，整合分支限小野無法呼叫的環境。正式資料庫的安裝須等資料庫角色與權限工單和規格 2.1 的上線前提完成。

## 安裝與驗證

`install(client)` 用傳入的 pg 連線，按檔名順序套用 `sql/` 內的 SQL。對新資料庫安裝時，呼叫端可包在一個交易裡提交。

測試以 `PPT_TEST_DATABASE_URL` 提供本機 PostgreSQL 16 連線資料，在儲存庫根目錄執行 `npx vitest run`。各資料庫測試檔建立並清理自己的測試資料庫。未設定該變數時，資料庫測試會略過。
