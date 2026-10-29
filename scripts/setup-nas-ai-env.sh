#!/usr/bin/env bash
# 将硅基流动 AI 配置写入 NAS 并重启容器
# 用法:
#   DEEPSEEK_VISION_API_KEY=sk-xxx NAS_PASS=密码 ./scripts/setup-nas-ai-env.sh
# 或从本地 .env 读取（若已填写 DEEPSEEK_VISION_API_KEY）:
#   NAS_PASS=密码 ./scripts/setup-nas-ai-env.sh

set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.1.102}"
NAS_USER="${NAS_USER:-logicloc}"
NAS_DIR="${NAS_DIR:-/volume1/docker/family-ledger}"
NAS_PASS="${NAS_PASS:?请设置 NAS_PASS}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_ENV="$ROOT/.env"

if [[ -z "${DEEPSEEK_VISION_API_KEY:-}" && -f "$LOCAL_ENV" ]]; then
  DEEPSEEK_VISION_API_KEY="$(grep -E '^DEEPSEEK_VISION_API_KEY=' "$LOCAL_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'" | tr -d ' ' || true)"
fi

KEY="${DEEPSEEK_VISION_API_KEY:-}"
if [[ -z "$KEY" || "$KEY" == sk-xxxxxxxx ]]; then
  echo "请设置 DEEPSEEK_VISION_API_KEY（硅基流动 API Key）" >&2
  echo "获取: https://cloud.siliconflow.cn/account/ak" >&2
  exit 1
fi

BASE="${DEEPSEEK_VISION_API_BASE:-https://api.siliconflow.cn}"
MODEL="${DEEPSEEK_VISION_MODEL:-Qwen/Qwen3-VL-8B-Instruct}"

ENV_BLOCK="# AI 发票识别（硅基流动）
DEEPSEEK_VISION_API_BASE=${BASE}
DEEPSEEK_VISION_MODEL=${MODEL}
DEEPSEEK_VISION_API_KEY=${KEY}
"

echo "==> 写入 NAS .env 并重启 family-ledger"
expect <<EOF
set timeout 120
spawn ssh -o StrictHostKeyChecking=no $NAS_USER@$NAS_HOST "set -e
cd $NAS_DIR
test -f .env || cp .env.nas.example .env
grep -v '^DEEPSEEK_VISION_' .env | grep -v '^# AI 发票识别' > .env.tmp || true
mv .env.tmp .env
cat >> .env <<'ENVEOF'

$ENV_BLOCK
ENVEOF
echo $NAS_PASS | sudo -S /usr/local/bin/docker-compose -f docker-compose.synology.yml up -d --force-recreate
sleep 2
echo $NAS_PASS | sudo -S /usr/local/bin/docker exec family-ledger node -e \"import('./server/deepseek.js').then(m=>console.log(JSON.stringify(m.getAiStatus())))\""
expect "password:" { send "$NAS_PASS\r" }
expect {
  "password for logicloc:" { send "$NAS_PASS\r"; exp_continue }
  eof
}
EOF

echo ""
echo "完成。请在浏览器打开 http://logicloc.home → 公司成本，确认 AI 状态已启用。"
