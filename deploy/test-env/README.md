# 呼嚕嚕小鎮改版測試環境

在本機或部署主機的倉庫複本執行下列步驟。Compose 專案 `purrtown-test` 使用獨立的 PostgreSQL 16 容器與具名資料卷。資料庫和 API 都只聽容器網路。對外只經專用通道放行 `/api/v2/`。

## 準備秘密檔

以下指令從倉庫根目錄開始。以部署使用者建檔，讓容器透過同一個群組唯讀存取所需檔案。若用不同的部署群組，先把檔案與目錄切換到該群組，再把 `PPT_TEST_SECRETS_GID` 設成對應的數字 GID。

```sh
cd deploy/test-env
umask 077
mkdir -p secrets
chmod 750 secrets
export PPT_TEST_SECRETS_GID="$(id -g)"

for secret_name in postgres-password web-password demo-teacher-password; do
  if [ ! -s "secrets/$secret_name" ]; then
    openssl rand -hex 24 > "secrets/$secret_name"
  fi
done

if [ ! -s secrets/setup-admin-url ]; then
  {
    printf 'postgresql://postgres:'
    tr -d '\r\n' < secrets/postgres-password
    printf '@db:%s/postgres\n' "${PPT_TEST_DB_PORT:-5432}"
  } > secrets/setup-admin-url
fi

chmod 640 secrets/postgres-password secrets/setup-admin-url \
  secrets/web-password secrets/demo-teacher-password
```

| `secrets/` 下的檔案 | 用途 |
| --- | --- |
| `postgres-password` | PostgreSQL 第一次初始化時的管理帳號密碼。 |
| `setup-admin-url` | setup 和 status 的管理連線字串，連到服務 `db` 的 `postgres` 庫。使用與 `postgres-password` 相同的密碼。若改用自備密碼，先做 URI 百分比編碼。 |
| `web-password` | setup 用它設定 `ppt_web` 登入。API 啟動時讀同一檔案，在程序內組裝連線字串。 |
| `demo-teacher-password` | setup 用 bcrypt 成本 10 保存示範老師的雜湊，smoke 用原密碼登入。檔案最多 72 個密碼位元組，結尾換行會移除。 |
| `cloudflared-config.yml` | 從通道範本複製的實際設定，唯讀掛載。 |
| `tunnel-credentials.json` | 專用的本地管理通道憑證 JSON，唯讀掛載供 cloudflared 讀取。 |

Compose 從目前 shell 讀取非秘密設定。設定好下列覆寫值再建映像與建庫，每次執行 Compose 時沿用相同設定。

- `PPT_TEST_DB_NAME` 預設 `ppt_test`。透過 Compose 設定時使用小寫英數字及底線。
- `PPT_TEST_DB_PORT` 預設 `5432`。變更時一併更新 `setup-admin-url` 裡的埠。
- `PPT_TEST_API_PORT` 預設 `3011`。變更時一併更新實際通道設定的上游與本機 smoke 的網址。
- `PPT_TEST_SUBNET` 與 `PPT_TEST_TUNNEL_IP` 預設 `172.31.209.0/24` 與 `172.31.209.10`。若子網段與既有網路重疊，一起更換兩值。API 只信任指定的通道位址。
- `PPT_TEST_DEMO_TEACHER_ID` 與 `PPT_TEST_DEMO_TEACHER_NAME` 都預設 `demo-teacher`。重跑時沿用同一個老師 ID。若之後有瀏覽器來源需求，再設定 `PPT_TEST_ALLOWED_ORIGINS`。
- `PPT_TEST_POSTGRES_IMAGE`、`PPT_TEST_NODE_IMAGE`、`PPT_TEST_CLOUDFLARED_IMAGE` 和 `PPT_TEST_API_IMAGE` 可覆寫映像參照。保留 PostgreSQL 16 Debian 版、Node 22 Debian slim 版與固定的 cloudflared 版本。

## 建映像與設定資料庫

從 `deploy/test-env/` 執行。setup 成功退出後再啟動 API。

```sh
docker compose build api
docker compose --profile setup run --rm setup
docker compose up -d db api
```

setup 依序建立角色、建庫、安裝舊表與兩套新版 SQL、設定授權與登入、實際驗證語系和權限，最後才寫入示範老師。成功時結束碼為 0。失敗時依畫面上的步驟與錯誤碼排查。

先從同一個 Compose 網路跑完整冒煙測試。一次性容器會依序印出 11 個步驟的結果。

```sh
docker compose --profile setup run --rm --no-deps --entrypoint node \
  -e "PPT_SMOKE_BASE_URL=http://api:${PPT_TEST_API_PORT:-3011}" \
  -e "PPT_SMOKE_TEACHER_NAME=${PPT_TEST_DEMO_TEACHER_NAME:-demo-teacher}" \
  -e PPT_SMOKE_PASSWORD_FILE=/run/secrets/demo_teacher_password \
  setup test-env/smoke.js
```

## 啟動通道與驗證外部路徑

為這個測試環境準備一條專用的本地管理通道和 DNS 記錄。把憑證 JSON 放入 `secrets/tunnel-credentials.json`。將 `cloudflared-config.example.yml` 複製成 `secrets/cloudflared-config.yml`，把 `<TUNNEL_ID>` 換成專用通道編號、`ppt-test.example.com` 換成測試子網域。若覆寫 API 埠，也更新上游網址。

```sh
chmod 640 secrets/cloudflared-config.yml secrets/tunnel-credentials.json
docker compose up -d
```

從可連到測試站的機器以 Node 22 執行。將網址換成測試站 HTTPS 網址，密碼檔的路徑指向執行機器上的示範老師秘密檔。下例從 `deploy/test-env/` 執行。

```sh
PPT_SMOKE_BASE_URL=https://ppt-test.example.com \
PPT_SMOKE_TEACHER_NAME="${PPT_TEST_DEMO_TEACHER_NAME:-demo-teacher}" \
PPT_SMOKE_PASSWORD_FILE=secrets/demo-teacher-password \
node ../../server/test-env/smoke.js
```

確認 `/` 與 `/api/v1/` 都回 HTTP 404。部署驗收時，另確認登入請求帶自訂 `X-Forwarded-For` 仍使用 Cloudflare 提供的來源位址計算登入桶。主機部署前後各核對一次既有同步服務的 PID 與健康檢查、共用通道設定雜湊與啟動時間、正式叢集的庫與角色清單。

## 查看狀態與重跑

```sh
docker compose --profile setup run --rm setup status \
  --database "${PPT_TEST_DB_NAME:-ppt_test}"
```

輸出三行數字，依序為 `ppt_web_state.login_buckets` 列數、`ppt_web_state.device_markers` 列數、資料庫大小（位元組）。

重跑 `docker compose --profile setup run --rm setup` 會保留既有資料。第 4 步在同一交易內安裝兩套新版 SQL，最後寫入 `ppt_web_state` schema 註解。下次見到三個 schema 及相同註解才略過安裝。既有 schema 缺少標記時會停在第 4 步。標記代表整批安裝曾提交，無法查出之後手動刪除的個別物件，也不會套用之後的版本變更。

重跑時角色設定會短暫收回 `ppt_web` 的登入能力。若要改 `web-password`，先停止 API，更新檔案、重跑 setup，再用 `docker compose up -d --force-recreate api` 建立新容器並讀取檔案。修改 `postgres-password` 檔只會影響全新資料卷的初始化。既有卷若需輪替管理密碼，須同步變更 PostgreSQL 裡的管理密碼及管理連線檔。

每次 smoke 都會留下新的 `smoke-` 假班及操作紀錄，供驗收查看。

## 停用與範圍

保留資料可以用 `docker compose stop`。確定可清空這套測試資料時，執行 `docker compose down -v` 刪除專案容器、網路與資料卷。完整撤除時，再移除測試子網域的 DNS 記錄、專用通道與這套部署的秘密檔。

本包不含網頁、舊版同步、小野、備份帳號或匯入舊班後的排程授權補登。
