#!/bin/bash
# Deploy purr-purr-town API to VPS
# 連線資訊改由未進版控的 .env.deploy 提供（範本見 .env.deploy.example）。
# 用法：先複製 .env.deploy.example 為 .env.deploy 填入實值，再執行 ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/.env.deploy" ]; then
  echo "缺少 $SCRIPT_DIR/.env.deploy，請複製 .env.deploy.example 並填入實值" >&2
  exit 1
fi
set -a; . "$SCRIPT_DIR/.env.deploy"; set +a

: "${DEPLOY_HOST:?請在 .env.deploy 設定 DEPLOY_HOST}"
: "${DEPLOY_USER:?請在 .env.deploy 設定 DEPLOY_USER}"
: "${DEPLOY_SSH_KEY:?請在 .env.deploy 設定 DEPLOY_SSH_KEY}"
: "${DEPLOY_DIR:?請在 .env.deploy 設定 DEPLOY_DIR}"
: "${DEPLOY_DB_USER:?請在 .env.deploy 設定 DEPLOY_DB_USER}"
: "${DEPLOY_DB_NAME:?請在 .env.deploy 設定 DEPLOY_DB_NAME}"

echo "=== Purr Purr Town API 部署 ==="

echo "[1/4] 同步 server 檔案到 VPS..."
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='.env.deploy' \
  -e "ssh -i $DEPLOY_SSH_KEY" \
  "$SCRIPT_DIR/" "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_DIR}/"

echo "[2/4] 安裝依賴..."
ssh -i "$DEPLOY_SSH_KEY" "${DEPLOY_USER}@${DEPLOY_HOST}" "cd ${DEPLOY_DIR} && npm install --production"

echo "[3/4] 初始化資料庫（schema 失敗即中止，不再靜默略過）..."
ssh -i "$DEPLOY_SSH_KEY" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "cd ${DEPLOY_DIR} && set -a; . ./.env; set +a; PGPASSWORD=\$DB_PASSWORD psql -h 127.0.0.1 -U ${DEPLOY_DB_USER} -d ${DEPLOY_DB_NAME} -f schema.sql"

echo "[4/4] 重啟服務..."
ssh -i "$DEPLOY_SSH_KEY" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "cd ${DEPLOY_DIR} && pm2 restart ppt-api 2>/dev/null || pm2 start index.js --name ppt-api --node-args='--env-file=.env' && pm2 save"

echo "=== 部署完成 ==="
echo "健康檢查：對 ${DEPLOY_HOST} 的 /health 端點確認回應"
