#!/usr/bin/env bash
# 构建并同步「代码」到群晖 NAS，然后远程启动 Docker。
#
# 数据以 NAS 为准：默认绝不上传/覆盖 data/ 与 .env。
#
# 用法:
#   NAS_PASS=密码 ./scripts/deploy-to-synology.sh
#
# 可选环境变量:
#   NAS_HOST=192.168.1.102
#   NAS_USER=logicloc
#   NAS_DIR=/volume1/docker/family-ledger
#   SYNC_DATA=FORCE   # 危险：用本机 data/ 覆盖 NAS（仅在你明确要灌库时用）

set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.1.102}"
NAS_USER="${NAS_USER:-logicloc}"
NAS_DIR="${NAS_DIR:-/volume1/docker/family-ledger}"
NAS_PASS="${NAS_PASS:?请设置 NAS_PASS 环境变量}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RSYNC_SSH="ssh -o StrictHostKeyChecking=no"

echo "==> 本地构建"
cd "$ROOT"
npm run build

echo "==> 同步代码到 $NAS_USER@$NAS_HOST:$NAS_DIR（保留 NAS 的 data/ 与 .env）"
expect <<EOF
set timeout 600
spawn rsync -avz --delete -e "$RSYNC_SSH" \
  --exclude node_modules --exclude .git --exclude data --exclude .env \
  --exclude electron --exclude release --exclude dist-electron \
  --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
  "$ROOT/" "$NAS_USER@$NAS_HOST:$NAS_DIR/"
expect {
  -re "(?i)password:" { send "$NAS_PASS\r"; exp_continue }
  eof
}
EOF

if [[ "${SYNC_DATA:-}" == "FORCE" ]]; then
  echo "==> 警告：SYNC_DATA=FORCE，将用本机 data/ 覆盖 NAS 账本！"
  expect <<EOF
set timeout 600
spawn rsync -avz -e "$RSYNC_SSH" \
  --exclude '*.db-wal' --exclude '*.db-shm' --exclude 'last-cloud-pull.json' --exclude 'cloud-snapshot-*.json' \
  "$ROOT/data/" "$NAS_USER@$NAS_HOST:$NAS_DIR/data/"
expect {
  -re "(?i)password:" { send "$NAS_PASS\r"; exp_continue }
  eof
}
EOF
else
  echo "==> 跳过 data/（NAS 为唯一数据源）。切勿用本机账本覆盖 NAS。"
fi

echo "==> 远程构建并启动容器"
expect <<EOF
set timeout 900
spawn ssh -o StrictHostKeyChecking=no $NAS_USER@$NAS_HOST "cd $NAS_DIR && cp -n .env.nas.example .env 2>/dev/null || true && echo $NAS_PASS | sudo -S /usr/local/bin/docker-compose -f docker-compose.synology.yml up -d --build 2>&1"
expect {
  -re "(?i)password:" { send "$NAS_PASS\r"; exp_continue }
  eof
}
EOF

echo ""
echo "部署完成: http://logicloc.home  或  http://$NAS_HOST:3080"
echo "账本数据仍在 NAS: $NAS_DIR/data/"
