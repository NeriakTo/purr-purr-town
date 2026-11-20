# 改版資料庫寫入程序

甲段提供老師的手動點數調整（OP-24）、操作重送與放棄。資料表和函式位於 `ppt`。操作規格見 [v0.4 總則](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md) 與 [操作與點數](../../docs/revamp/operation-contract/02-操作規格-v0.4-操作與點數.md)。

## 資料表

| 表 | 用途與約束 |
|---|---|
| `classes` | 班級狀態、版本及從 0 起算的 `class_seq`。序號是提交游標，推進序號時班級資料的版本與最後改動者維持原值。 |
| `class_ownership` | 班級與老師的對應，每班一位擁有者。 |
| `class_authorizations` | 以班級與身分種類為鍵，預留小野及排程授權資料。 |
| `operations` | 以全庫唯一的 `op_id` 保存操作者、輸入、內容雜湊、狀態和收據。`recorded_at` 記登記時間。只有成立的操作有 `class_seq` 與 `committed_at`。 |
| `students` | 以班級與學生編號為鍵，保存座號、姓名、小組、在學狀態及版本。 |
| `accounts` | 每位學生一列，保存餘額、累計加分及版本。每寫一筆交易，帳戶版本加一並更新 `last_op_id`。 |
| `transactions` | 以班級與交易編號為鍵的存摺。來源與操作／轉換批次的關係由資料庫檢查，每筆根交易至多沖回一次。觸發程序擋下更新、刪除及清空。 |

所有編號用 `text`，可容納匯入的 64 字元編號。版本列預設 `rev = 1`、`last_op_id = NULL`。

## 入口

- `ppt.submit_operation(op jsonb, actor jsonb) RETURNS jsonb` 接收含 `class_id` 的單筆操作。操作使用 `op_id`、`type`、`payload`，選填 `expect`、`batch_id`、`client_time`、`client_seq`。老師身分形狀為 `{"kind":"teacher","id":"<老師編號>"}`。
- `ppt.cancel_operation(class_id text, op_id text, actor jsonb) RETURNS jsonb` 登記放棄或回原收據。放棄新編號時，操作紀錄的 `type`、`payload`、`expect` 及內容雜湊皆為空。
- `ppt.submit_locked_operation(p_op jsonb, p_actor jsonb) RETURNS jsonb` 是內部共用入口。外層須先驗信封、授權、編號、隔離層級，並持有已重驗授權的班級鎖。批次呼叫者可在同一交易逐筆使用。

老師入口要求 `read committed`，其他隔離層級拋出 `25000`。入口由呼叫端提交或回復，班級鎖持有到該交易結束。每筆操作取得班級鎖後取一次 `clock_timestamp()`，共用於該筆操作與它產生的交易。

## 收據

不保存的結果固定為 `{ "op_id": "…", "status": "retry", "code": "…" }`。沒有字串形式的編號時，`op_id` 為 JSON null。

保存的收據有 `op_id`、`status`、`code`、`replayed`、`class_seq`、`committed_at`、`result`、`changes`、`warnings`。非成立收據的序號與提交時間為 JSON null。

- `result` 有 `noop`、`transactions`、`effects_added`、`effects_reversed`。手動點數調整的交易清單只有新交易編號。
- `changes` 各項記 `entity`、`key`、`prev_rev`、`rev`、`prev_value`、`value`、`last_op_id`。帳戶的值包含 `balance` 與 `total_earned`。繳交與訂正之後也會記前後的基準版本。
- `STALE_STATE` 收據另帶 `current`，內容是判定版本不符時記下的資料。
- 重送讀取已保存的收據，僅將回傳的 `replayed` 設為 `true`。同編號異班、異操作者或異內容回 `OP_ID_REUSED`。同班、同操作者提交已放棄的編號時，回 `cancelled`、`OP_CANCELLED`。放棄已存在的編號時，只比班級與操作者。

## 檢查順序

1. 提交先檢查交易隔離層級，再驗信封。操作須為物件、有非空的字串 `class_id`，且 `payload` 以資料庫的 JSONB 文字輸出計算，最多 64 KiB UTF-8。信封不符回 `BAD_ENVELOPE`。
2. 驗老師身分與班級存取權，接著驗編號格式。鎖住班級列後再驗一次存取權。班級不存在或無存取權都回 `CLASS_FORBIDDEN`，編號不符回 `INVALID_OP_ID`。放棄使用同一組存取與鎖定檢查。
3. 登記編號。主鍵處理跨班同編號競爭。已有編號時依重送規則比對，內容衝突回 `OP_ID_REUSED`。
4. 新操作依序檢查 `UNKNOWN_OP_TYPE`、`FORBIDDEN_ROLE`、`CLASS_ARCHIVED`、輸入的 `INVALID_PAYLOAD`、小野的 `SCOPE_FORBIDDEN`、`NOT_FOUND`、`ENTITY_INACTIVE`、`INVALID_TRANSITION`、`STALE_STATE`、各操作專屬檢查。專屬檢查若有 `ID_CONFLICT`，排在其餘專屬檢查之前。甲段執行 OP-24 用到的檢查。
5. 套用操作後，推進 `class_seq` 並保存收據。OP-24 的金額是非零整數，絕對值至多 100000，理由至多 100 字，省略或空白時存「手動調整」。帳戶可為負值，這筆交易的 `earned_delta` 等於 `amount`。

操作檢查或寫入要定案拒絕時，呼叫 `ppt.reject_operation(p_code ppt.operation_code, p_current jsonb DEFAULT NULL)`。這支函式使用 SQLSTATE `P604R`，把規格錯誤碼放在 `MESSAGE`，選填的 `current` JSON 放在 `DETAIL`。核心只攔這個 SQLSTATE，先回復該筆的檢查與寫入區塊，再把拒絕收據存進已登記的操作列。其他例外往外拋。偵測到已標記的未實作分支時，`ppt.pending_operation(p_key text)` 拋出 `0A000`，`DETAIL` 為該分支鍵。

## 暫定做法

- 資料庫以 `type`、`class_id`、`payload` 與 `expect` 組成 JSONB，轉成 UTF-8 文字後計算 SHA-256。鍵順序和輸入排版不影響比對，陣列順序會影響。省略 `expect` 和傳 JSON null 在雜湊中相同。新編號若帶 `expect`，包含 JSON null，累加型驗證會拒絕。已登記的編號先走重送比對。雜湊只供資料庫使用，中繼資料與傳送路徑不參與比對。
- 瀏覽器與小野的編號採 36 字元小寫 UUID v4。排程與系統採 v5，外部入口收到 v5 回 `INVALID_OP_ID`。放棄允許封存班。鎖等待逾時由呼叫端控制。
- 只要成立就推進班級序號，包括日後會支援的 `noop`。版本變更的 `entity` 與 `key` 採 `account`／`{student_id}`、`submission`／`{task_id, student_id}`、`product`／`{product_id}`、`inventory_item`／`{item_id}`。
- 乙段的購買專屬檢查依次為 `PRICE_CHANGED`、`OUT_OF_STOCK`、`INSUFFICIENT_BALANCE`。幣別採 `currency` 的舊版 `tier1.rate`／`tier2.rate`，依序對應 `fish`／`cookie`，預設 100／1000，`point` 為 1。
- 乙段的 `agent_submit` 由資料庫固定填入小野身分，會集中在一個函式取得。若 `call_id` 或任何一筆 `op_id` 不合格式，整批回 `INVALID_OP_ID`，不保存。

## 未實作清單

| 鍵 | 缺少的分支 | 補上的分包 |
|---|---|---|
| `actor_scheduler_system` | 排程及系統身分入口 | 第 5 包排程、第 9 包系統 |
| `class_create` | OP-01 在班級列尚不存在時的建班路徑 | 第 9 包 |

下一次派工的乙段會接上 OP-14、OP-31 及小野最小批次入口。正式資料庫的安裝須等資料庫角色與權限工單和規格 2.1 的上線前提完成。

## 安裝與驗證

`install(client)` 用傳入的 pg 連線，按檔名順序套用 `sql/` 內的 SQL。對新資料庫安裝時，呼叫端可包在一個交易裡提交。

測試以 `PPT_TEST_DATABASE_URL` 提供本機 PostgreSQL 16 連線資料，在儲存庫根目錄執行 `npx vitest run`。各資料庫測試檔建立並清理自己的測試資料庫。未設定該變數時，資料庫測試會略過。
