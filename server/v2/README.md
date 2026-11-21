# 新版後端操作介面

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
