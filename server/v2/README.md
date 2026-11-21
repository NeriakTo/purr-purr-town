# 新版後端操作介面

三個端點皆使用 `POST` 與 JSON。請求本文上限為 512 KiB。端點先驗證 `Authorization: Bearer <權杖>`，再檢查信封與班級存取權。權杖是 64 個小寫十六進位字元，資料庫以 SHA-256 雜湊查找。到期取 `expires_at` 與 `first_relayed_at + 24 小時` 中較早者。未曾經 GAS 轉送時只用 `expires_at`。操作者固定為工作階段所屬的老師。

## 端點

| 路徑 | 請求 | HTTP 200 回應 |
| --- | --- | --- |
| `/api/v2/ops` | `{ "v": 1, "class_id": "…", "batch_id": "…", "ops": […] }` | `{ "server_time": "…", "class_seq": 1, "receipts": […] }` |
| `/api/v2/ops/cancel` | `{ "class_id": "…", "op_id": "…" }` | `{ "server_time": "…", "receipt": {…} }` |
| `/api/v2/ops/lookup` | `{ "class_id": "…", "op_ids": ["…"] }` | `{ "server_time": "…", "results": […] }` |

`server_time` 是結尾為 `Z` 的 ISO 8601 UTC 時間。所有請求的 `class_id` 都須為非空字串。

### 提交

`ops` 須有 1 到 50 個物件，字串 `op_id` 不得重複。單筆 `payload` 以 `JSON.stringify` 後的 UTF-8 大小計算，最多 64 KiB。未帶 `op_id` 或不是字串時，由寫入程序回單筆 `INVALID_OP_ID`。頂層 `batch_id` 可省略、為 null 或非空字串。

每筆只取 `op_id`、`type`、`payload`、`expect`、`client_time`、`client_seq`，以及頂層的 `class_id` 和選填的 `batch_id`。`expect` 省略與明帶 null 各依原值送入寫入程序。班級預先檢查不上鎖。只有班級不存在且首筆是 `class.create`、其 `payload.class_id` 和頂層相同時，才放行建班。

每筆依陣列順序開啟獨立的 `READ COMMITTED` 交易，設定本次交易的等鎖與語句逾時，呼叫寫入程序並提交。提交完成才把原樣收據放入回應。頂層 `class_seq` 在最後一筆之後另讀，可能已包含別人的提交，班級不存在時為 null。

單筆遇到暫時型的 `CLASS_FORBIDDEN`、`SERVER_BUSY`、`INTERNAL_ERROR` 時保留該筆與之前的收據。其餘操作不進寫入程序，依原順序回 `{ "op_id": "…", "status": "retry", "code": "NOT_PROCESSED" }`，缺少編號時用 null。定案拒絕、`INVALID_OP_ID`、`OP_ID_REUSED` 及單筆 `BAD_ENVELOPE` 都會繼續處理下一筆。

### 放棄

放棄須有班級存取權，不存在的班與別人的班都回相同的 403。寫入程序與提交共用班級鎖。新編號登記為 `cancelled`，同班且同操作者的既有編號回原收據並設 `replayed: true`。不同班或不同操作者的既有編號回 `OP_ID_REUSED`。缺少 `op_id` 或編號無效（含 UUID v5）回 `INVALID_OP_ID`。鎖內失去班級存取權也回請求層級的 403。

### 查詢原操作

`op_ids` 接受 1 到 50 個字串。先驗班級存取權，再用 `REPEATABLE READ READ ONLY` 交易讀操作紀錄，無須取得班級鎖。依輸入順序回覆，同一編號出現多次會在各位置回覆。屬於本班、操作者種類為老師且操作者編號和工作階段相同的紀錄，回原樣收據加 `op_type`，放棄登記的種類為 null。其餘各回 `{ "op_id": "…", "status": "unknown" }`。例如可用撤銷衝突的 `current.last_op_id` 查出阻擋操作是 `legacy_effect.resolve`。

## HTTP 狀態與錯誤碼

請求層級的失敗只回 `{ "error": { "code": "…" } }`。提交或放棄帶收據的回應均為 HTTP 200，送出端依收據中的結果碼處置。後端不自動重試，送出端遇暫時錯誤或回應遺失時以同一個編號重送。

| HTTP 狀態 | 請求層級錯誤碼 | 條件 |
| --- | --- | --- |
| 400 | `BAD_ENVELOPE` | JSON 或信封不合法、內容型別不符、超出上限 |
| 401 | `AUTH_REQUIRED` | 缺少有效格式的權杖或找不到工作階段 |
| 401 | `AUTH_EXPIRED` | 找得到工作階段但已到期 |
| 403 | `CLASS_FORBIDDEN` | 無班級存取權或班級不存在 |
| 503 | `SERVER_BUSY` | 取不到連線、交易工作期間連線中斷、SQLSTATE `55P03` 或 `57014` |
| 500 | `INTERNAL_ERROR` | 其他未預期錯誤或提交失敗 |

提交端點在單筆交易中發生上述資料庫錯誤時，把對應碼放在該筆的 `retry` 收據。若交易的 `COMMIT` 回報失敗，結果可能不明，同編號重送可安全確認。逾時預設為等鎖 5,000 毫秒、語句 30,000 毫秒，可由 `config` 設定。這一包依派工暫定的 HTTP 狀態、信封、建班例外、批次停止條件、逾時、回應外層、欄位取用、工作階段與查詢隔離層級執行。第 2 包才會實作 HTTP 429 `RATE_LIMITED`。

## 網站帳號需要的權限

執行時需要能使用 `ppt` 與 `ppt_web_state` schema。以下是這一包在路由直接使用的物件。

| 動作 | 物件與用途 |
| --- | --- |
| 讀寫 | `ppt_web_state` 全部表開放 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 給網站帳號。提交操作時讀取 `sessions` 驗證權杖。 |
| 讀取 | `public.teachers` 的 `id`、`name`、`passcode_hash` 用於登入及查詢工作階段。正式站的授權由資料庫遷移工單 T-606 負責。 |
| 讀取 | `ppt.classes` 的 `class_id`、`class_seq`，用於建班預先檢查與提交回應 |
| 讀取 | `ppt.operations` 的 `op_id`、`class_id`、`actor_kind`、`actor_id`、`type`、`receipt`，用於查詢原操作 |
| 執行授權查詢 | `ppt.can_access_class(text, jsonb)`，用於班級預先檢查 |
| 執行寫入入口 | `ppt.submit_operation(jsonb, jsonb)` 與 `ppt.cancel_operation(text, text, jsonb)`，由寫入程序負責修改 `ppt` 資料 |

先安裝 `server/db-v2/`，再以 `ppt_owner` 身分用 `server/v2/install.js` 安裝網站狀態。最後執行的 `server/v2/sql/990-web-state-privileges.sql` 授權網站角色並收回 PUBLIC 權限。小野與備份角色無權存取 `ppt_web_state`。T-605 負責 `ppt` 內的角色授權與寫入入口。

## 登入

`POST /api/v2/auth/login` 接受至多 4 KiB 的 JSON 物件。必填 `name`（1 至 50 字）及 `passcode`（非空字串），可帶先前收到的 `device_marker`。

成功回 HTTP 200，欄位為 `server_time`、`token`、`expires_at`、`device_marker` 與 `teacher`（含 `id`、`name`）。時間採 ISO 8601，權杖與裝置標記均為 64 個小寫十六進位字元，伺服器只存各自的 SHA-256 雜湊。再次登入會簽發新權杖。有效且屬於該老師的裝置標記會原樣回傳，其他情況簽發新標記。裝置標記供登入分桶使用，驗證仍需密碼或有效權杖。

信封格式錯誤或超過上限回 HTTP 400 `BAD_ENVELOPE`。帳號不存在、密碼錯誤、同名多列皆回 HTTP 401 `LOGIN_FAILED`。錯誤格式為 `{"error":{"code":"…"}}`。

`x-ppt-relay-key` 與部署設定 `PPT_V2_RELAY_KEY` 的 SHA-256 摘要以固定時間比對，相符才認定經 GAS。密鑰須為至少 32 個可列印 ASCII 字元。設定未填或是空字串時一律走直連判定。直連登入的初始效期為 90 天，經 GAS 登入為 24 小時。

測試支架在測試庫執行舊版 schema，授予 `ppt_web` 讀取 `public.teachers` 所需欄位的權限。

## 工作階段查詢與登出

兩個端點都要求 `Authorization: Bearer <token>`，可省略本文，也可送 JSON 物件。查詢 `POST /api/v2/auth/session` 成功回 HTTP 200，含 `server_time`、`teacher`（含 `id`、`name`）與 `expires_at`。登出 `POST /api/v2/auth/logout` 刪除該權杖後回 HTTP 200，含 `server_time`。權杖缺少、無法識別或完成登出後使用，回 HTTP 401 `AUTH_REQUIRED`。查詢時若找不到老師資料也回此碼。過期回 HTTP 401 `AUTH_EXPIRED`，該列保留。登出前已驗過權杖的操作請求會繼續處理。

已登入端點在解析本文前驗證權杖。經 GAS 的請求只記第一次的時間，包含本文無效或無權操作的請求。實際效期取原效期與第一次經 GAS 後 24 小時的較早時間，到期當下即失效。只走直連、尚未到期且效期剩不到 30 天的權杖，延展至當下加 90 天。曾經 GAS 的權杖不延展。

經 GAS 的判定影響權杖效期，以及乙段要接的登入分桶與直連來源站台檢查。兩條路的操作授權、執行與收據規則一致。

## 增量讀取的接線

`read-wiring.test.js` 使用 PostgreSQL 16，以一筆實際成立的操作驗每種實體。下表各版本列以 `class_id` 與 `last_op_id = op_id` 接到 `ppt.operations`。查到的序號等於收據與當下的班級序號。

| 實體 | 接線欄位 | 測試名稱 |
| --- | --- | --- |
| `class` | `ppt.classes.last_op_id` | class 的最後操作接到收據與班級序號 |
| `student` | `ppt.students.last_op_id` | student 的最後操作接到收據與班級序號 |
| `account` | `ppt.accounts.last_op_id` | account 的最後操作接到收據與班級序號 |
| `submission` | `ppt.submissions.last_op_id` | submission 的最後操作接到收據與班級序號 |
| `task` | `ppt.tasks.last_op_id` | task 的最後操作接到收據與班級序號 |
| `rule` | `ppt.rules.last_op_id` | rule 的最後操作接到收據與班級序號 |
| `confirmation` | `ppt.confirmations.last_op_id` | confirmation 的最後操作接到收據與班級序號 |
| `correction` | `ppt.corrections.last_op_id` | correction 的最後操作接到收據與班級序號 |
| `product` | `ppt.products.last_op_id` | product 的最後操作接到收據與班級序號 |
| `inventory_item` | `ppt.inventory_items.last_op_id` | inventory_item 的最後操作接到收據與班級序號 |
| `setting` | `ppt.settings_entries.last_op_id` | setting 的最後操作接到收據與班級序號 |
| `job` | `ppt.jobs.last_op_id` | job 的最後操作接到收據與班級序號 |
| `duty` | `ppt.daily_duties.last_op_id` | duty 的最後操作接到收據與班級序號 |
| `group` | `ppt.groups.last_op_id` | group 的最後操作接到收據與班級序號 |
| `announcement` | `ppt.announcements.last_op_id` | announcement 的最後操作接到收據與班級序號 |
| `seating` | `ppt.seating.last_op_id` | seating 的最後操作接到收據與班級序號 |
| `comment` | `ppt.comments.last_op_id` | comment 的最後操作接到收據與班級序號 |

| 情況 | 實測結果 | 測試名稱 |
| --- | --- | --- |
| 小野暫緩 | 班級序號不動，待確認項目的最後操作有紀錄但序號為空。第 3 包需要另取待確認資料。 | 小野暫緩的待確認項目連到空序號，班級序號維持原值 |
| OP-53 歷史效果 | 效果狀態改變，效果列無欄位指向裁決。繳交列指向裁決並接得到序號。第 3 包可透過變更的繳交帶出關聯效果。 | OP-53 裁決更新效果狀態，序號經繳交列取得 |
| OP-51 整批撤銷 | 回復的帳戶指向內部撤銷，內部撤銷有自己的序號，外層之後才取號。 | OP-51 回復的帳戶連到內部撤銷序號 |
| 存摺交易 | `ppt.transactions.op_id` 可接到成立序號。 | 存摺交易的 op_id 接到成立序號 |
| 效果建立與沖回 | `ppt.effects.created_op_id` 及 `reversed_op_id` 各接到對應的成立序號。 | 效果建立與沖回各自接到成立序號 |

## 後續分包

- 第 2 包負責登入、登出、工作階段查詢與延展、裝置標記、限流、排隊及 GAS 轉送識別。
- 第 3 包負責班級清單、整班狀態、增量變更、匯出，並依上表處理暫緩項目與歷史效果。
- 第 4 包負責排程、評語產生的後端流程、舊版整包寫入關閉開關及收尾清點。
