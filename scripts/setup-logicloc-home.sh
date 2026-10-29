#!/usr/bin/env bash
# 在群晖上配置 logicloc.home 反向代理（80 → 3080）与本地 DNS 解析
# 用法: NAS_PASS='密码' ./scripts/setup-logicloc-home.sh

set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.1.102}"
NAS_USER="${NAS_USER:-logicloc}"
NAS_PASS="${NAS_PASS:?请设置 NAS_PASS}"
DOMAIN="${DOMAIN:-logicloc.home}"
UPSTREAM_PORT="${UPSTREAM_PORT:-3080}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF_SRC="$ROOT/scripts/synology/http.logicloc.home.conf"
CONF_DEST="/usr/local/etc/nginx/conf.d/http.logicloc.home.conf"
DNSMASQ_SNIPPET="/etc/dnsmasq.d/logicloc.home.conf"

expect <<EOF
set timeout 60
spawn rsync -avz -e "ssh -o StrictHostKeyChecking=no" "$CONF_SRC" "$NAS_USER@$NAS_HOST:/tmp/logicloc.home.conf"
expect "password:" { send "$NAS_PASS\r" }
expect eof
EOF

expect <<EOF
set timeout 120
spawn ssh -o StrictHostKeyChecking=no $NAS_USER@$NAS_HOST "set -e
echo '$NAS_PASS' | sudo -S cp /tmp/logicloc.home.conf $CONF_DEST
echo '$NAS_PASS' | sudo -S chmod 644 $CONF_DEST
grep -q '$DOMAIN' /etc/hosts || echo '$NAS_PASS' | sudo -S sh -c 'echo \"192.168.1.102 $DOMAIN\" >> /etc/hosts'
if [ -d /etc/dnsmasq.d ]; then
  echo '$NAS_PASS' | sudo -S sh -c 'echo \"address=/$DOMAIN/192.168.1.102\" > /etc/dnsmasq.d/logicloc.home.conf'
  echo '$NAS_PASS' | sudo -S synoservicecfg --restart dnsmasq 2>/dev/null || true
fi
echo '$NAS_PASS' | sudo -S nginx -t
echo '$NAS_PASS' | sudo -S synosystemctl reload nginx 2>/dev/null || echo '$NAS_PASS' | sudo -S nginx -s reload
curl -s -o /dev/null -w 'health:%{http_code}\\n' -H 'Host: $DOMAIN' http://127.0.0.1/api/health || true
"
expect "password:" { send "$NAS_PASS\r" }
expect {
  "password for logicloc:" { send "$NAS_PASS\r"; exp_continue }
  eof
}
EOF

# Mac 本机 hosts（需要 sudo）
if ! grep -q "$DOMAIN" /etc/hosts 2>/dev/null; then
  echo "正在写入 Mac /etc/hosts（需要本机 sudo 密码）..."
  echo "192.168.1.102 $DOMAIN" | sudo tee -a /etc/hosts >/dev/null || true
fi

echo ""
echo "完成。浏览器访问: http://$DOMAIN"
echo "若其他设备无法解析，请在路由器(192.168.1.250)添加 DNS: $DOMAIN → 192.168.1.102"
