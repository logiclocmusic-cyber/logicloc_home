#!/usr/bin/env bash
# 【危险】将本机 data/ 覆盖到 NAS。当前生产数据以 NAS 为准，一般不要用本脚本。
#
# 若确实要用本机灌库到 NAS：
#   CONFIRM=YES ./scripts/sync-data-to-nas.sh user@192.168.1.102:/volume1/docker/family-ledger/data
#
# 日常备份请反过来：从 NAS 拉到本机，而不是推上去。

set -euo pipefail

if [[ "${CONFIRM:-}" != "YES" ]]; then
  echo "拒绝执行：本机 data/ 会覆盖 NAS 账本。" >&2
  echo "生产数据以 NAS 为准。若你确认要覆盖，请设置 CONFIRM=YES 再运行。" >&2
  exit 1
fi

DEST="${1:?用法: CONFIRM=YES $0 user@host:/path/to/data}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/data/"

if [[ ! -d "$SRC" ]]; then
  echo "未找到本地 data 目录: $SRC" >&2
  exit 1
fi

echo "警告：正在用本机数据覆盖 NAS：$SRC -> $DEST"
echo "提示：请先停止 NAS 上的 family-ledger 容器，避免 SQLite 写入冲突"

rsync -avz --progress \
  --exclude '*.db-wal' \
  --exclude '*.db-shm' \
  --exclude 'last-cloud-pull.json' \
  --exclude 'cloud-snapshot-*.json' \
  "$SRC" "$DEST"

echo "完成。可在 NAS 上重启: docker-compose -f docker-compose.synology.yml up -d"
