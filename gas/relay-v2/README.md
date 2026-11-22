# 新版 GAS 轉送

## 部署網頁應用程式

1. 在 Google Apps Script 建立獨立專案，使用 V8 執行階段。將這個目錄的 `Code.gs` 貼到專案的指令碼檔案並儲存。部署帳號須啟用兩步驟驗證。
2. 在「專案設定 → 指令碼屬性」設定下列欄位。

   | 屬性名稱 | 設定方式 |
   | --- | --- |
   | `PPT_RELAY_BACKEND_URL` | 填單一新版後端的 HTTPS 來源，包含通訊協定與主機，需要時加通訊埠。GAS 會自行加上白名單路徑。 |
   | `PPT_V2_RELAY_KEY` | 使用與新版後端同名設定相同的密鑰，至少 32 個可列印 ASCII 字元。GAS 將此值放入 `x-ppt-relay-key` 標頭。 |
   | `PPT_RELAY_PASS` | 選填。空值或省略表示停用。啟用時，瀏覽器送出的 `relay_pass` 須與此值完全相同。 |

3. 選擇「部署 → 新增部署作業 → 網頁應用程式」。執行身分選「我」（部署者），存取權選「任何人」（允許未登入 Google 的使用者）。依畫面完成部署者授權。
4. 將部署後的 `/exec` 網址提供給前端作為轉送入口。更新程式時，在「管理部署作業」編輯既有部署並選擇新版本。

前端以 `POST` 和 `text/plain;charset=utf-8` 送出外層 JSON，網址不帶參數。正常轉送回 HTTP 200，`http_status` 與 `body_text` 保留後端狀態及原始本文。GAS 自行拒絕或後端連線失敗時，`http_status` 為 `0`，原因放在 `gas_error`。

## 本機端到端測試

本機替身直接載入本目錄的 `Code.gs`。請先啟動只用假資料的本機測試後端。替身監聽 `127.0.0.1`，後端也須使用該位址的 HTTP 來源。

從儲存庫根目錄執行下列指令，使用程序環境提供上表三個欄位的測試值。可另外設定 `PPT_RELAY_PORT` 指定通訊埠。省略時由系統分配，程式會印出實際通訊埠。

```sh
node gas/relay-v2/local-server.js
```

測試程式也可匯入 `startRelayServer({ backendUrl, relayKey, relayPass, port, upstreamTimeoutMs })`。函式在開始監聽後回傳 Node HTTP 伺服器，測試可用 `server.address().port` 取得通訊埠，結束時呼叫 `server.close()`。本機後端請求的預設逾時為 60 秒。瀏覽器可跨來源發送上述格式的簡單請求。

只跑轉送測試時，執行 `npm test -- test/relay-v2.test.js`。
