# 新版後端操作介面

操作與讀取端點皆使用 `POST` 與 JSON。請求本文上限為 512 KiB。端點先驗證 `Authorization: Bearer <權杖>`，再檢查信封與班級存取權。權杖是 64 個小寫十六進位字元，資料庫以 SHA-256 雜湊查找。到期取 `expires_at` 與 `first_relayed_at + 24 小時` 中較早者。未曾經 GAS 轉送時只用 `expires_at`。操作者固定為工作階段所屬的老師。

## 端點

| 路徑 | 請求 | HTTP 200 回應 |
| --- | --- | --- |
| `/api/v2/ops` | `{ "v": 1, "class_id": "…", "batch_id": "…", "ops": […] }` | `{ "server_time": "…", "class_seq": 1, "receipts": […] }` |
| `/api/v2/ops/cancel` | `{ "class_id": "…", "op_id": "…" }` | `{ "server_time": "…", "receipt": {…} }` |
| `/api/v2/ops/lookup` | `{ "class_id": "…", "op_ids": ["…"] }` | `{ "server_time": "…", "results": […] }` |

`server_time` 是結尾為 `Z` 的 ISO 8601 UTC 時間。需要 `class_id` 的請求須帶非空字串。

### 提交

`ops` 須有 1 到 50 個物件，字串 `op_id` 不得重複。單筆 `payload` 以 `JSON.stringify` 後的 UTF-8 大小計算，最多 64 KiB。未帶 `op_id` 或不是字串時，由寫入程序回單筆 `INVALID_OP_ID`。頂層 `batch_id` 可省略、為 null 或非空字串。

每筆只取 `op_id`、`type`、`payload`、`expect`、`client_time`、`client_seq`，以及頂層的 `class_id` 和選填的 `batch_id`。`expect` 省略與明帶 null 各依原值送入寫入程序。

班級預先檢查不上鎖。班級不存在時，只有首筆是 `class.create`、其 `payload.class_id` 為字串且等於頂層編號，而頂層編號符合小寫 UUID v4 格式，才放行至寫入程序。寫入程序仍負責檢查操作編號與承接來源，承接來源可用 64 字元舊編號。依規格 2.6 第 3 點，符合這些條件的建班可辨識 UUID v4 編號是否已被別人使用。其餘請求依班級存取權判斷，別人的班與不存在的班皆回相同的 HTTP 403 `CLASS_FORBIDDEN`，兩邊皆無寫入。

每筆依陣列順序開啟獨立的 `READ COMMITTED` 交易，設定本次交易的等鎖與語句逾時，呼叫寫入程序並提交。提交完成才把原樣收據放入回應。頂層 `class_seq` 在最後一筆之後另讀，可能已包含別人的提交，班級不存在時為 null。

若操作已成立，但另讀頂層 `class_seq` 時連線中斷，整個請求回 HTTP 503。送出端用同一個操作編號重送，拿回原收據。

單筆遇到暫時型的 `CLASS_FORBIDDEN`、`SERVER_BUSY`、`INTERNAL_ERROR` 時保留該筆與之前的收據。其餘操作不進寫入程序，依原順序回 `{ "op_id": "…", "status": "retry", "code": "NOT_PROCESSED" }`，缺少編號時用 null。定案拒絕、`INVALID_OP_ID`、`OP_ID_REUSED` 及單筆 `BAD_ENVELOPE` 都會繼續處理下一筆。

### 放棄

放棄須有班級存取權，不存在的班與別人的班都回相同的 403。寫入程序與提交共用班級鎖。新編號登記為 `cancelled`，同班且同操作者的既有編號回原收據並設 `replayed: true`。不同班或不同操作者的既有編號回 `OP_ID_REUSED`。缺少 `op_id` 或編號無效（含 UUID v5）回 `INVALID_OP_ID`。鎖內失去班級存取權也回請求層級的 403。

### 查詢原操作

`op_ids` 接受 1 到 50 個字串。先驗班級存取權，再用 `REPEATABLE READ READ ONLY` 交易讀操作紀錄，無須取得班級鎖。依輸入順序回覆，同一編號出現多次會在各位置回覆。屬於本班、操作者種類為老師且操作者編號和工作階段相同的紀錄，回原樣收據加 `op_type`，放棄登記的種類為 null。其餘各回 `{ "op_id": "…", "status": "unknown" }`。例如可用撤銷衝突的 `current.last_op_id` 查出阻擋操作是 `legacy_effect.resolve`。

## 讀取

| 路徑 | 請求 JSON | HTTP 200 回應 |
| --- | --- | --- |
| `/api/v2/read/classes` | 可省略本文或帶 JSON 物件，本文欄位忽略 | `{ server_time, classes }` |
| `/api/v2/read/state` | `{ class_id }` | `{ server_time, class_seq, rows, transactions, operations, legacy_effects, payroll, agent_batches }` |
| `/api/v2/read/state` | `{ class_id, cursor }` | `{ server_time, class_seq, stream, items, next }` |
| `/api/v2/read/changes` | `{ class_id, since_seq }` | `{ server_time, class_seq, full, rows, transactions, operations, legacy_effects, payroll, agent_batches }` |
| `/api/v2/read/export` | `{ class_id }` | `{ server_time, export_v, exported_at, class_id, class_seq, rows, transactions, effects, rule_versions }` |

四條路徑都需要工作階段，解析本文前先驗權杖並計入帳號限流。班級編號取自本文，信封只檢查格式，忽略未知的鍵。缺班與無存取權皆回相同的 HTTP 403 `CLASS_FORBIDDEN`。每個請求的讀取走同一個 `REPEATABLE READ READ ONLY` 交易，班級序號與資料取自同一個快照。讀取交易的每句查詢預設最多 30,000 毫秒，可用 `config.statementTimeoutMs` 調整。

`classes` 陣列只列權杖老師擁有的班，包含封存班，依 `class_id` 排序。每筆含 `class_id`、`class_seq`、`rev`、`value`、`last_export_at`。其中 `value` 與 `class` 版本列相同，從未匯出時 `last_export_at` 為 null。

每筆 `rows` 為 `{ entity, key, rev, value }`，依 `entity`、再依 `key` 的 JSON 字串排序。各實體的 `key` 和 `value` 型別與收據的 `changes` 一致，`value` 帶整列可用欄位。包含 `assignment_active: false` 的繳交。送出端可依 `rev` 合併收據與讀取。

### 交易與操作分頁

整班首讀的 `transactions` 與 `operations` 各是 `{ items, next }`。有下一頁時把 `next` 原樣填入下一次整班讀取的 `cursor`。伺服器依本文的 `class_id` 查詢，游標只帶串流名稱與最後一筆排序鍵。無下一頁回 null。無效游標回 HTTP 400 `BAD_ENVELOPE`。每頁預設 500 筆，`config.read.pageSize` 接受 1 至 2,000 的整數。

- 交易依操作 `class_seq`、`occurred_at`、`transaction_id` 由大到小排列。每筆是交易表欄位去掉 `class_id`，另加 `class_seq`。匯入交易的 `class_seq` 為 null，排序時視為 0。
- 操作只列已成立的紀錄，依 `class_seq` 由大到小排列。每筆帶 `op_id`、`type`、`actor_kind`、`class_seq`、`committed_at`、`batch_id`、`client_time`、`payload`。

翻頁時新提交的操作及交易可用第一頁的 `class_seq` 拉增量。

### 增量讀取與衍生欄位

`since_seq` 必須是 0 以上的 JSON 安全整數。等於 0、超過快照的班級序號、或其後已成立的操作筆數超過門檻時，回整班首讀的內容並加 `full: true`。門檻預設 500 筆，`config.read.changesFullThreshold` 接受 1 至 100,000 的整數。

其餘回 `full: false`。版本列、交易及操作取成立序號嚴格大於 `since_seq` 的紀錄，交易與操作在增量回應中直接給陣列。`rows` 也固定帶全部尚未處理的待確認項目，讓未推進班級序號的暫緩批次可見。

- `legacy_effects` 帶 `effect_id`、`student_id`、`task_id`、`status`、`suggested_transaction_id`、`candidates`。整班列未裁決效果。增量也帶變動繳交的已裁決效果，以及有繳交、交易或效果變動之學生的全部未裁決效果。候選欄位為 `transaction_id`、`effective_amount`、`reason`、`effective_at`、`default_listed`、`suggested`。建議項目優先，其餘依時間、再依編號由小到大。只有理由完全等於「作業遲交」或「作業缺交」的候選標為 `default_listed`。已裁決效果的候選為空陣列。
- `payroll` 每個職務一筆，帶 `job_id`、臺灣日期 `pay_date`、`period`、`first_day`、`needs_legacy_confirmation`。日、週、月與學期職務依期別首日和切換日判定，一次性職務的首日為 null，匯入的一次性職務要確認。增量每次帶完整清單。
- `agent_batches` 每批帶 `batch_id`、`created_at`、`note`、`op_count`、`seats`、`pending_held`、`held_ops`、`undone`。最近七天以及仍待確認的批次皆列入，按建立時間由新到舊。筆數及座號從這批新成立的操作計算。待確認時 `held_ops` 帶原始暫緩內容，其餘為 null。增量每次帶完整清單。

### 匯出

`export_v` 為 1。`rows` 與整班讀取相同，`transactions` 帶全部交易，`effects` 與 `rule_versions` 分別帶本班所有效果及規則版本的資料表欄位。匯出格式不含操作串流。

快照讀完後，伺服器以獨立短交易寫入 `ppt_web_state.class_exports`，以兩次匯出時間中較晚的為準。成功後才回備份，`exported_at` 與班級清單回的 `last_export_at` 使用相同 ISO 8601 UTC 格式。這筆寫入不推進班級序號，也不產生操作紀錄。寫入失敗回請求層級錯誤。

## HTTP 狀態與錯誤碼

新版後端的請求層級錯誤回 `{ "error": { "code": "…" } }`。HTTP 429 另帶整數秒數 `retry_after`，登入桶忙碌時也會帶 `reason: "bucket_busy"`。提交、放棄與查詢回傳收據時使用 HTTP 200，送出端依收據結果碼處置。下表的新版路徑省略 `/api/v2/`。規格編號見 [操作規格 01 第 5 節](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md#五錯誤碼表)。

| 規格編號 | 錯誤碼 | HTTP 狀態 | 端點與條件 |
| --- | --- | --- | --- |
| E-01 | `AUTH_REQUIRED` | 401；GAS 包裝見下 | 除 `auth/login` 外的九個新版端點。缺少有效權杖、工作階段查無或已登出。工作階段查詢的老師查無時也回此碼。GAS 可在轉送前回此碼。 |
| E-02 | `AUTH_EXPIRED` | 401 | 除 `auth/login` 外的九個新版端點。工作階段仍保留但已到期。 |
| E-03 | `CLASS_FORBIDDEN` | 403；提交單筆收據 200 | `ops`、`ops/cancel`、`ops/lookup`、`read/state`、`read/changes`、`read/export`。班級不存在或呼叫者無權存取。提交在班級鎖內失去權限時回單筆 `retry`。 |
| E-04 | `RATE_LIMITED` | 429 | 十個新版端點。已登入端點依帳號限流，登入依桶與程序容量、排隊及等待期限限流。 |
| E-05 | `SERVER_BUSY` | 503；提交單筆收據 200 | 十個新版端點。連線無法取得、交易工作期間連線中斷、等鎖或語句逾時。登入超過比對租約也回此碼。提交單筆交易遇到時回 `retry`。 |
| E-06 | `UPSTREAM_UNREACHABLE` | GAS 包裝 | GAS 無法連上新版後端或後端逾時。 |
| E-07 | `INTERNAL_ERROR` | 500；提交單筆收據 200 | 十個新版端點。未預期錯誤或提交交易失敗。提交單筆交易遇到時回 `retry`。 |
| E-08 | `NOT_PROCESSED` | 提交單筆收據 200 | `ops`。同一請求前一筆操作得到會中止該批的暫時型結果，本筆未送入寫入程序。 |
| E-09 | `BAD_ENVELOPE` | 400；提交單筆收據 200；GAS 包裝 | 十個新版端點可在解析或驗證請求本文時回 400。寫入程序可對 `ops` 單筆操作回此碼。GAS 在包裝不合法時也會回。 |
| E-10 | `ROUTE_NOT_ALLOWED` | GAS 包裝 | GAS 轉送路徑不在白名單時回此碼。 |
| E-11 | `INVALID_OP_ID` | 收據 200 | `ops`、`ops/cancel`。操作編號缺少、格式無效或版本不是第 4 版。 |
| E-12 | `OP_ID_REUSED` | 收據 200 | `ops`、`ops/cancel`。提交的編號已用於不同內容、操作者或班級，或要放棄的編號已被其他操作者或班級用過。 |
| E-13 | `PAIRING_INVALID` | 不適用 | 配對端點及此碼已移除。 |
| E-14 | `LEGACY_WRITE_CLOSED` | 舊後端，HTTP 410 | `PUT /api/v1/snapshots/:classId`、`DELETE /api/v1/classes/:classId`、`POST /api/v1/classes`。`POST /api/v1/auth/register` 由獨立開關控制。 |
| E-45 | `RELAY_FORBIDDEN` | GAS 包裝 | GAS 已啟用轉送通行碼，請求缺少或帶錯通行碼。 |
| 後端新增 | `LOGIN_FAILED` | 401 | `auth/login`。帳號不存在、密碼錯誤或帳號名稱重複。後端新增，送出端處置見[規格 01 第五節](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md#五錯誤碼表)。 |
| 後端新增 | `ORIGIN_FORBIDDEN` | 403 | 十個新版端點。直連帶了站台未允許的 `Origin`。後端新增，送出端處置見[規格 01 第五節](../../docs/revamp/operation-contract/01-操作規格-v0.4-總則.md#五錯誤碼表)。 |

「GAS 包裝」指 GAS 自己回錯時，外層 HTTP 為 200，本文 `http_status` 為 0，錯誤碼在 `gas_error`。寫入程序定案的操作層級結果依規格 01 第 5.2 節出現在提交收據。放棄與查詢也能帶回原有的定案收據。背景工作使用內部收據，沒有 HTTP 回應。

單筆 `payload` 剛好 64 KiB 可能通過網站端檢查，卻因寫入程序的 JSONB 文字大小計法而得到單筆 `BAD_ENVELOPE`。送出端的單筆上限須留 1 KiB 餘裕，以 63 KiB 為上限。

操作遇暫時錯誤或回應遺失時，送出端用同一編號重送。若交易的 `COMMIT` 回報失敗，結果可能不明，同編號重送可確認。寫入逾時由 `config.lockTimeoutMs`（預設 5,000 毫秒）與 `config.statementTimeoutMs`（預設 30,000 毫秒）設定。HTTP 429 的計數依下方登入桶與帳號限流規則。

## 網站帳號需要的權限

執行時需要能使用 `ppt` 與 `ppt_web_state` schema。以下是路由與背景工作使用的物件。

| 動作 | 物件與用途 |
| --- | --- |
| 讀寫 | `ppt_web_state` 全部表開放 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 給網站帳號。提交操作時讀取 `sessions` 驗證權杖。 |
| 讀取 | `public.teachers` 的 `id`、`name`、`passcode_hash` 用於登入及查詢工作階段，`created_at` 用於帶標記的比對排序。正式站的 `public.teachers.created_at` 讀取權由 T-606 處理，是上線前提。 |
| 讀取 | `ppt.classes` 的 `class_id`、`class_seq`，用於建班預先檢查與提交回應 |
| 讀取 | `ppt.operations` 的 `op_id`、`class_id`、`actor_kind`、`actor_id`、`type`、`receipt`，用於查詢原操作 |
| 讀取 | `ppt.class_ownership`、`classes`、`students`、`accounts`、`submissions`、`tasks`、`rules`、`rule_versions`、`confirmations`、`corrections`、`products`、`inventory_items`、`settings_entries`、`jobs`、`daily_duties`、`groups`、`announcements`、`seating`、`comments`、`transactions`、`operations`、`effects`、`agent_calls`。由 `server/db-v2/sql/990-privileges.sql` 授予網站帳號 `SELECT`。 |
| 讀寫 | `ppt_web_state.class_exports` 的 `SELECT`、`INSERT`、`UPDATE`，供班級清單與匯出使用。 |
| 讀取 | `ppt.classes`、`ppt.operations`、`ppt.comments`、`ppt.students` 的 `SELECT`，供排程班級名單、評語請求、名冊及清掃使用。由 `server/db-v2/sql/990-privileges.sql:26` 授予。 |
| 刪除 | `ppt_web_state.sessions`、`ppt_web_state.login_queue`、`ppt_web_state.bucket_busy_counts` 的 `DELETE`，供定期清除使用。由 `server/v2/sql/990-web-state-privileges.sql:5` 授予。 |
| 執行授權查詢 | `ppt.can_access_class(text, jsonb)`，用於班級預先檢查 |
| 執行寫入入口 | `ppt.submit_operation(jsonb, jsonb)` 與 `ppt.cancel_operation(text, text, jsonb)`，由寫入程序負責修改 `ppt` 資料 |

先安裝 `server/db-v2/`，再以 `ppt_owner` 身分用 `server/v2/install.js` 安裝網站狀態。最後執行的 `server/v2/sql/990-web-state-privileges.sql` 授權網站角色並收回 PUBLIC 權限。小野與備份角色無權存取 `ppt_web_state`。T-605 負責 `ppt` 內的角色授權與寫入入口。

排程與評語都沿用 `ppt.submit_operation`，第 5 版編號由 Node 計算。本包不需要新的函式執行權。

## 登入

`POST /api/v2/auth/login` 接受至多 4 KiB 的 JSON 物件。必填 `name`（1 至 50 字）及 `passcode`（非空字串），可帶先前收到的 `device_marker`。

成功回 HTTP 200，欄位為 `server_time`、`token`、`expires_at`、`device_marker` 與 `teacher`（含 `id`、`name`）。時間採 ISO 8601，權杖與裝置標記均為 64 個小寫十六進位字元，伺服器只存各自的 SHA-256 雜湊。再次登入會簽發新權杖。有效且屬於該老師的裝置標記會原樣回傳，其他情況簽發新標記。裝置標記供登入分桶使用，驗證仍需密碼或有效權杖。

信封格式錯誤或超過上限回 HTTP 400 `BAD_ENVELOPE`。帳號不存在、密碼錯誤、同名多列皆回 HTTP 401 `LOGIN_FAILED`。錯誤格式為 `{"error":{"code":"…"}}`。

`x-ppt-relay-key` 與部署設定 `PPT_V2_RELAY_KEY` 的 SHA-256 摘要以固定時間比對，相符才認定經 GAS。密鑰須為至少 32 個可列印 ASCII 字元。設定未填或是空字串時一律走直連判定。直連登入的初始效期為 90 天，經 GAS 登入為 24 小時。

測試支架在測試庫執行舊版 schema，授予 `ppt_web` 讀取 `public.teachers` 的 `id`、`name`、`passcode_hash`、`created_at`。

## 工作階段查詢與登出

兩個端點都要求 `Authorization: Bearer <token>`，可省略本文，也可送 JSON 物件。查詢 `POST /api/v2/auth/session` 成功回 HTTP 200，含 `server_time`、`teacher`（含 `id`、`name`）與 `expires_at`。登出 `POST /api/v2/auth/logout` 刪除該權杖後回 HTTP 200，含 `server_time`。權杖缺少、無法識別或完成登出後使用，回 HTTP 401 `AUTH_REQUIRED`。查詢時若找不到老師資料也回此碼。過期回 HTTP 401 `AUTH_EXPIRED`，該列保留。登出前已驗過權杖的操作請求會繼續處理。

已登入端點在解析本文前驗證權杖。經 GAS 的請求只記第一次的時間，包含本文無效或無權操作的請求。實際效期取原效期與第一次經 GAS 後 24 小時的較早時間，到期當下即失效。只走直連、尚未到期且效期剩不到 30 天的權杖，延展至當下加 90 天。曾經 GAS 的權杖不延展。

經 GAS 的判定影響權杖效期、登入分桶與直連來源站台檢查。兩條路的操作授權、執行與收據規則一致。

## 登入分桶與帳號限流

有效裝置標記各自成桶，直連與經 GAS 共用同一個標記桶。無有效標記時，經 GAS 以帳號名稱分桶，直連以來源位址與帳號名稱分桶。桶鍵只存 SHA-256，查無帳號的請求也計數。連續失敗五次後，本桶接下來的請求依序先等 1、2、4、8 秒，後續每次等 8 秒。密碼正確時將本桶的連續失敗數歸零。

同一桶用 PostgreSQL 共用租約與排隊順序。租約包含桶的延遲、等比對位置的上限與 10 秒比對時間。排隊、延遲與比對期間會釋回資料庫連線，只有登記、輪詢及寫入結果時才查資料庫。每桶最多三個等待者，每 200 毫秒查看是否輪到，最多等 30 秒。每個後端程序最多 50 個等桶的請求。桶排隊滿或逾時時回 HTTP 429 `RATE_LIMITED`，`retry_after` 為 `30`，`reason` 為 `bucket_busy`。`ppt_web_state.bucket_busy_counts` 按帳號名稱記錄次數和最後時間。

每個後端程序預設最多同時比對三筆，包含查無帳號時的假比對。假雜湊在建立 app 時開始產生。直連與經 GAS 的無標記請求合計最多佔兩個位置，保留一個給有效標記。位置釋出時，優先給目前沒有進行中比對的類別，同等順位時由各類隊首等待最久的先取得。無標記各類依進隊順序等候；帶標記依帳號建立時間、老師編號、進隊順序排列，缺少建立時間者排最後。帶標記隊伍已滿時，排序更前的新請求可替換隊尾。

直連與經 GAS 的無標記請求各可同時處理 16 筆，取得租約並等完桶的延遲後，各可排 8 筆等位置，最長等 2 秒。有效標記在同一程序內每個帳號同時處理一筆，最多另有一筆等前筆回應，最長等 5 秒。全程序的帶標記位置隊伍可排 64 筆，最長等 5 秒。

程序的處理或等待限制觸發時，回 HTTP 429 `RATE_LIMITED`，`retry_after` 為 `5`，省略 `reason`。在取租約前被拒的請求沒有資料庫寫入。已取租約的請求被拒時會清除租約並保留失敗次數。程序每分鐘最多寫一筆包含 `route`、`code`、`marked`、`gas`、`direct` 的 429 彙總，只有發生拒絕才寫。位置的等待期限是租約到期減去比對時間。比對超出租約時回 503 `SERVER_BUSY`，不發權杖也不計失敗。原比對完成前仍佔用程序的位置，其他程序可依資料庫租約接手。

`config.login` 可調整桶的 `failureThreshold`（5）、`delaysMs`（`[1000, 2000, 4000, 8000]`）、`queueLimit`（3）、`queueWaitMs`（30000）、`pollMs`（200）、`leaseMs`（10000）、`maxWaiters`（50），以及程序的 `verifySlots`（3）、`anonymousInFlightPerRoute`（16）、`anonymousQueuePerRoute`（8）、`anonymousSlotWaitMs`（2000）、`markedQueueLimit`（64）、`markedSlotWaitMs`（5000）。時間皆為毫秒。啟動入口以 `UV_THREADPOOL_SIZE` 設定 `config.login.threadPoolSize`，未設定時使用 4。比對位置須至少 3 個，且至少留出一條執行緒。最大桶延遲加上帶標記等位置期限與比對租約，合計須小於等桶的期限。

需權杖的端點驗證權杖後，以老師編號按 UTC 整分鐘計數，預設每分鐘 120 次，可由 `config.accountRateLimit` 調整。直連與 GAS 使用同一額度，同帳號的多個權杖也共用；登入不計入。超額回 HTTP 429 `RATE_LIMITED`，`retry_after` 是距下一個分鐘區間的秒數，無條件進位。帳號限流存在程序記憶體，執行兩個程序時各自計數。

學校只能走 GAS 時，持續被填滿的無標記桶可能讓新裝置反覆收到 `bucket_busy`。已登入過且保有有效裝置標記的裝置可使用獨立桶。維護者可依個別名稱的 `bucket_busy` 計數判讀，並在確認後啟用 GAS 的轉送通行碼。

## 部署時的來源設定

直連請求若帶 `Origin`，須列於 `config.allowedOrigins`（環境變數 `PPT_V2_ALLOWED_ORIGINS`），否則在驗權杖與解析本文前回 HTTP 403 `ORIGIN_FORBIDDEN`。未帶 `Origin` 或有效經 GAS 的請求可繼續，`OPTIONS` 由 CORS 處理。

預設以連線對端為來源位址。部署經代理時，`config.trustProxy` 只列出可信代理的位址或 CIDR；環境變數 `PPT_V2_TRUST_PROXY` 以逗號分隔。不可設定信任全部的網段或 `true`，程式也會拒絕數字與函式設定。正式值由 T-609 按實際的代理層配置。`PPT_V2_RELAY_KEY` 啟用時須為至少 32 個可列印 ASCII 字元。

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

## 舊版整包寫入關閉

舊後端的 `LEGACY_WRITE_CLOSED` 擋下儲存快照、刪班和建班或改班。原路徑為 `PUT /api/v1/snapshots/:classId`、`DELETE /api/v1/classes/:classId`、`POST /api/v1/classes`。`LEGACY_REGISTER_CLOSED` 獨立控制 `POST /api/v1/auth/register`。

兩個環境變數都接受字面值 `true`（擋）、`false`（放行）與空字串（放行）。未設定也放行。其他值會使 `buildApp` 失敗。程式可用布林選項 `legacyWriteClosed`、`legacyRegisterClosed` 覆蓋個別環境變數。

啟用時，受控路由在限流、驗權杖和查資料庫前回 HTTP 410。兩種本文如下。

| 路由 | 本文 |
| --- | --- |
| 三條寫入路由 | `{ "success": false, "error": "舊版已停止寫入，請重新整理網頁改用新版", "code": "LEGACY_WRITE_CLOSED" }` |
| 註冊路由 | `{ "success": false, "error": "舊版已停止開新帳號", "code": "LEGACY_WRITE_CLOSED" }` |

舊版的班級清單、快照與版本讀取、登入、登出及工作階段查詢照常提供。

## 逾期排程

每個臺灣日期 00:10 起，依班級編號逐一對 `active` 班送 OP-52。臺灣日期按 UTC+8 計算。00:10 後啟動可補跑當日，下一次排程會涵蓋漏跑期間已逾期的訂正。每班各自交易，以 `scheduler` 身分提交。

操作編號使用 UUID v5，命名空間為 `7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8`。名稱格式 `schedule.correction_overdue:<class_id>:<YYYY-MM-DD>` 已凍結。同一班同一臺灣日期在重啟及多個程序中會算出同一個編號。

成立、重送、定案拒絕與 `CLASS_FORBIDDEN` 在程序內按日期結案。`SERVER_BUSY` 或 `INTERNAL_ERROR` 留到下一輪用原編號再送。單班失敗會記錄結果碼並繼續處理後續班級。匯入班級有排程授權列後才可成立。

## 評語產生

新成立的 OP-46 在提交後發動背景產生，包含成立但沒有改資料的請求。重送只回原收據，HTTP 回應無須等待產生完成。同一程序對同班、同學生、同學期只同時產生一次。學生與學期取自同班已成立的 OP-46，查不到時記錄結果碼。

`buildV2App` 以選項 `walle` 注入非同步函式 `walle(input, { signal })`。提供給瓦力的 `input` 有四個鍵。

| 鍵 | 值 |
| --- | --- |
| `observation` | 單一目標學生的觀察紀錄，已把名冊姓名換成代稱。 |
| `student_label` | 目標學生的「N號」或「座號未定」。 |
| `comment_locked` | 評語鎖定布林值。 |
| `motto_locked` | 箴言鎖定布林值。 |

班級編號、學生編號、學期與名冊留在後端。

遮名用全班名冊，包含轉出、封存與在家自學的學生。先比長的拼法，依序考慮去空白的完整姓名、三字以上去第一字、四字以上取最後兩字。比對忽略英文字母大小寫和字間空白，空白包括半形、全形、定位字元、換行及其餘指定的 Unicode 空白。共用拼法的兩到三位學生依座號列出代稱，四位以上用「某位同學」，空座號用「座號未定」。綽號、錯字、單姓及兩字姓名只寫一字等寫法可能漏遮。常用詞若與姓名拼法相同會一併遮名。

瓦力回傳四個字串 `comment`、`motto`、`analysis`、`model`。以 Unicode 字元計數，上限分別為 2,000、200、5,000、100，`model` 至少一字。禁止 U+0000 與不成對的代理字元。前三個欄位只還原目標學生的獨立座號代稱，其他數字前綴、目標無座號或拼法與其他學生重疊時保留代稱。還原後再驗一次長度與格式。

後端以 `system` 身分提交 OP-47，UUID v5 名稱為 `comment.apply_generated:<request_op_id>`，使用與排程相同的命名空間。遇暫時型結果以設定的退避時間重送同一編號和內容。用完重送仍失敗時交給清掃。資料庫保留老師已修改的欄位，晚到的產生結果存成建議稿。鎖定欄位由寫入程序保護。

| 情況 | 寫入 OP-47 的錯誤文字 |
| --- | --- |
| 計時到期，取消瓦力 | 評語產生逾時，請重按產生 |
| 瓦力丟錯 | 評語產生失敗，請重按產生 |
| 未注入瓦力 | 評語產生功能尚未啟用 |
| 輸出格式或長度不合格 | 產生結果不符格式，請重按產生 |
| 清掃中斷的產生 | 產生中斷，請重按產生 |

清掃從未封存班的「產生中」評語找同班、同學生、同學期序號最大的已成立 OP-46。提交時間嚴格超過門檻、沒有該請求的 OP-47 紀錄，且本程序沒有正在產生時，才用同一套用編號寫入中斷結果。不同程序同時清掃時只成立一次。關閉 app 會取消進行中的瓦力呼叫並等待收尾，被關閉而中斷的產生由後續輪次清掃。

## 背景工作與定期清除

入口在開始接受請求後立即跑一輪，依序執行逾期排程、網站狀態清除、評語清掃。每輪結束後取離下次臺灣 00:10 的時間與設定間隔的較小值，安排下一輪。工作失敗會記錄安全的錯誤碼並繼續。關閉時等待背景工作停止後才關閉連線池。

網站狀態清除讓三張表各自使用短交易，以注入的時鐘算界線。

| 表 | 刪除條件 |
| --- | --- |
| `ppt_web_state.sessions` | 實際到期時間早於保留期界線。尚在保留期回 `AUTH_EXPIRED`，已清除回 `AUTH_REQUIRED`。 |
| `ppt_web_state.login_queue` | 已過期超過五分鐘。 |
| `ppt_web_state.bucket_busy_counts` | `last_at` 早於保留期界線。 |

`login_buckets`、`device_markers`、`class_exports` 保留原列。

| `buildV2App` 設定 | 預設 | 有效值 |
| --- | --- | --- |
| `config.jobs.intervalMs` | 600,000 | 60,000 至 3,600,000 毫秒的整數。 |
| `config.cleanup.sessionRetentionMs` | 30 天 | 1 至 365 天，以整數毫秒填入。 |
| `config.cleanup.busyCountRetentionMs` | 30 天 | 1 至 365 天，以整數毫秒填入。 |
| `config.comments.timeoutMs` | 120,000 | 1,000 至 600,000 毫秒的整數。 |
| `config.comments.retryDelaysMs` | `[1000, 2000, 4000]` | 最多五項，每項為 0 至 60,000 毫秒的整數。 |
| `config.comments.sweepAfterMs` | 600,000 | 安全整數毫秒。須嚴格大於 `timeoutMs` 加上全部重送等待，再加上 `statementTimeoutMs × (retryDelaysMs.length + 1)`。 |
| `config.statementTimeoutMs` | 30,000 | PostgreSQL 語句逾時，非負整數毫秒。入口也可用 `PPT_V2_STATEMENT_TIMEOUT_MS` 設定。 |
| `config.lockTimeoutMs` | 5,000 | PostgreSQL 等鎖逾時，非負整數毫秒。入口也可用 `PPT_V2_LOCK_TIMEOUT_MS` 設定。 |

背景工作與清掃使用 `clock` 和 `timers`，評語重送使用 `sleep`。預設採系統時鐘與 Node 計時器。建 app 時驗證工作及評語設定，工作在入口啟動。

## 殘餘事項

第 4 包是本工單最後一包。後續事項如下。

- 實際瓦力連線留給第 3 階段工單。
- T-605 第 3 包併入後，以網站帳號連線池重跑本包與第 3 包的資料庫測試，以及 `server/v2/web-state-privileges.test.js`、`server/db-v2/privileges-catalog.test.js`。另測相同合法名冊與文字在兩套遮名實作中的結果一致。不合法名冊各依其錯誤契約處理。
- 正式站的舊版寫入開關由 T-613 切換。是否關閉註冊，留待 1D 切換規劃與 Kevin 一起決定新老師開帳號的方式。
- T-609 先替登入桶及裝置標記加列數監看，清除策略另開工單。
- 匯入舊班由匯入程序及 T-609 先跑 `server/db-v2/maintenance/backfill-scheduler-authorizations.sql`，補齊排程授權。
- 新程式部署與 nginx 分流交 T-609。網站後端、小野、瓦力的系統帳號隔離是上線前提，由 T-605、T-606 處理。
- T-607 全套以網站帳號連線池重跑，依主控排程執行。
