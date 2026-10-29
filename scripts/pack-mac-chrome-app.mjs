#!/usr/bin/env node
/**
 * 打包 Mac 应用：内嵌 Node 服务 + 系统 Chrome 独立窗口（--app），不捆绑 Electron/Chromium。
 */
import {
  cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync,
  chmodSync, statSync, readdirSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const productName = pkg.productName || "Loc's Home";
const version = pkg.version || '1.0.0';
const bundleExe = 'LocHome';

const archArg = process.argv.find(a => a === '--arm64' || a === '--x64');
const hostArch = execSync('uname -m', { encoding: 'utf8' }).trim();
const targetArch = archArg?.slice(2) || (hostArch === 'arm64' ? 'arm64' : 'x64');
const nodeVersion = (process.env.PACK_NODE_VERSION || '22.16.0').replace(/^v/, '');

const releaseDir = join(root, 'release', 'chrome-app');
const appName = `${productName}.app`;
const appPath = join(releaseDir, appName);
const contents = join(appPath, 'Contents');
const macosDir = join(contents, 'MacOS');
const resDir = join(contents, 'Resources');
const appBundleDir = join(resDir, 'app');
const nodeDir = join(resDir, 'node');
const seedDir = join(resDir, 'seed');
const stagingDir = join(root, '.cache', 'pack-app-staging');
const dmgPath = join(root, 'release', `${productName}-${version}-chrome-${targetArch}.dmg`);

function log(msg) {
  console.log(msg);
}

async function downloadNodeRuntime() {
  const cacheDir = join(root, '.cache', 'node-runtime');
  mkdirSync(cacheDir, { recursive: true });
  const folder = `node-v${nodeVersion}-darwin-${targetArch}`;
  const extracted = join(cacheDir, folder);
  const nodeBin = join(extracted, 'bin', 'node');
  if (existsSync(nodeBin)) {
    log(`使用缓存 Node ${nodeVersion} (${targetArch})`);
    return extracted;
  }

  const url = `https://nodejs.org/dist/v${nodeVersion}/${folder}.tar.gz`;
  const tgz = join(cacheDir, `${folder}.tar.gz`);
  log(`下载 Node ${nodeVersion} (${targetArch})…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 Node 失败: ${url} (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));
  execSync(`tar -xzf "${tgz}" -C "${cacheDir}"`, { stdio: 'inherit' });
  if (!existsSync(nodeBin)) throw new Error(`Node 解压后未找到: ${nodeBin}`);
  return extracted;
}

function stageNodeRuntime(extracted) {
  if (existsSync(nodeDir)) rmSync(nodeDir, { recursive: true });
  mkdirSync(join(nodeDir, 'bin'), { recursive: true });
  cpSync(join(extracted, 'bin', 'node'), join(nodeDir, 'bin', 'node'));
  chmodSync(join(nodeDir, 'bin', 'node'), 0o755);
  const lib = join(extracted, 'lib');
  if (existsSync(lib)) cpSync(lib, join(nodeDir, 'lib'), { recursive: true });
  const include = join(extracted, 'include');
  if (existsSync(include)) cpSync(include, join(nodeDir, 'include'), { recursive: true });
}

function stageProductionModules() {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'package.json'), JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    dependencies: pkg.dependencies,
  }, null, 2));
  cpSync(join(root, 'package-lock.json'), join(stagingDir, 'package-lock.json'));
  log('安装生产依赖（omit dev）…');
  execSync('npm ci --omit=dev --ignore-scripts', { cwd: stagingDir, stdio: 'inherit' });
  const dest = join(appBundleDir, 'node_modules');
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  cpSync(join(stagingDir, 'node_modules'), dest, { recursive: true });
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>${bundleExe}</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleIdentifier</key><string>app.logicloc.home.chrome</string>
  <key>CFBundleName</key><string>${productName}</string>
  <key>CFBundleDisplayName</key><string>${productName}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMultipleInstancesProhibited</key><false/>
</dict>
</plist>`;
  writeFileSync(join(contents, 'Info.plist'), plist, 'utf8');
}

function writeLauncher() {
  const launcherPath = join(macosDir, bundleExe);
  const script = `#!/bin/bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

APP_TITLE=${JSON.stringify(productName)}
APP_SUPPORT="$HOME/Library/Application Support/${productName}"
DATA_ROOT="$APP_SUPPORT/data"
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
NODE="$RES/node/bin/node"
APP="$RES/app"
SEED="$RES/seed/ledger.db"
PID_FILE="$APP_SUPPORT/server.pid"
PORT_FILE="$APP_SUPPORT/server.port"
LOG_FILE="$APP_SUPPORT/server.log"
CONFIG="$APP_SUPPORT/config.env"
CURL="/usr/bin/curl"
LSOF="/usr/sbin/lsof"
OPEN="/usr/bin/open"

mkdir -p "$DATA_ROOT/gear-images" "$DATA_ROOT/invoices" "$DATA_ROOT/family-events" "$DATA_ROOT/tesseract-cache"

if [[ ! -f "$DATA_ROOT/ledger.db" && -f "$SEED" ]]; then
  cp "$SEED" "$DATA_ROOT/ledger.db"
fi

if [[ ! -f "$CONFIG" ]]; then
  cat > "$CONFIG" <<'EOF'
# Loc's Home 本地配置（AI 发票识别）
DEEPSEEK_VISION_API_BASE=https://api.siliconflow.cn
DEEPSEEK_VISION_MODEL=Qwen/Qwen3.5-9B
DEEPSEEK_VISION_API_KEY=
# GEMINI_API_KEY=
# GEMINI_MODEL=gemini-2.5-flash-lite
EOF
fi

find_free_port() {
  local p=37123
  while (( p < 37200 )); do
    if ! "$LSOF" -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  echo 37123
}

wait_for_http() {
  local port="$1" i
  for (( i=0; i<80; i++ )); do
    if "$CURL" -sf "http://127.0.0.1:$port/" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}

open_chrome_app() {
  local port="$1"
  local url="http://127.0.0.1:$port/"
  local chrome_app=""
  for candidate in "/Applications/Google Chrome.app" "/Applications/Chromium.app" "/Applications/Microsoft Edge.app"; do
    if [[ -d "$candidate" ]]; then chrome_app="$candidate"; break; fi
  done
  if [[ -z "$chrome_app" ]]; then
    /usr/bin/osascript -e "display alert \\"$APP_TITLE\\" message \\"请先安装 Google Chrome\\"" || true
    return 1
  fi
  "$OPEN" -na "$chrome_app" --args --app="$url" --window-size=1320,880 --disable-session-crashed-bubble
}

stop_server() {
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  rm -f "$PORT_FILE"
}

# 已有实例：只打开 Chrome，不杀服务
if [[ -f "$PID_FILE" && -f "$PORT_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"
  OLD_PORT="$(cat "$PORT_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null && wait_for_http "$OLD_PORT"; then
    open_chrome_app "$OLD_PORT" || exit 1
    exit 0
  fi
  stop_server
fi

if [[ ! -x "$NODE" ]]; then
  /usr/bin/osascript -e "display alert \\"$APP_TITLE\\" message \\"缺少 Node 运行时\\"" || true
  exit 1
fi

PORT="$(find_free_port)"
export NODE_ENV=production SERVE_STATIC=true LISTEN_HOST=127.0.0.1 LOCAL_PIN=5281
export PORT="$PORT" DIST_DIR="$APP/dist" DB_PATH="$DATA_ROOT/ledger.db"
export GEAR_IMG_DIR="$DATA_ROOT/gear-images" INVOICE_DIR="$DATA_ROOT/invoices"
export FAMILY_EVENT_DIR="$DATA_ROOT/family-events" TESSERACT_CACHE="$DATA_ROOT/tesseract-cache"
export APP_CONFIG_PATH="$CONFIG"

: > "$LOG_FILE"
cd "$APP"
"$NODE" server/index.js >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
echo "$PORT" > "$PORT_FILE"

if ! wait_for_http "$PORT"; then
  /usr/bin/osascript -e "display alert \\"$APP_TITLE\\" message \\"本地服务启动失败，请查看 server.log\\"" || true
  stop_server
  exit 1
fi

open_chrome_app "$PORT" || { stop_server; exit 1; }

trap stop_server EXIT INT TERM
while kill -0 "$SERVER_PID" 2>/dev/null; do
  sleep 2
done
`;
  writeFileSync(launcherPath, script, 'utf8');
  chmodSync(launcherPath, 0o755);
}

function stageAppFiles() {
  if (existsSync(appPath)) rmSync(appPath, { recursive: true });
  mkdirSync(macosDir, { recursive: true });
  mkdirSync(seedDir, { recursive: true });

  const dist = join(root, 'dist');
  if (!existsSync(dist)) throw new Error('缺少 dist/，请先运行 npm run build');

  mkdirSync(appBundleDir, { recursive: true });
  cpSync(dist, join(appBundleDir, 'dist'), { recursive: true });
  cpSync(join(root, 'server'), join(appBundleDir, 'server'), { recursive: true });
  mkdirSync(join(appBundleDir, 'src'), { recursive: true });
  cpSync(join(root, 'src', 'import-manager.js'), join(appBundleDir, 'src', 'import-manager.js'));
  cpSync(join(root, 'package.json'), join(appBundleDir, 'package.json'));

  stageProductionModules();

  const seed = join(root, 'electron', 'seed', 'ledger.db');
  if (existsSync(seed)) {
    cpSync(seed, join(seedDir, 'ledger.db'));
  } else {
    const localDb = join(root, 'data', 'ledger.db');
    if (existsSync(localDb)) cpSync(localDb, join(seedDir, 'ledger.db'));
  }

  const icns = join(root, 'build', 'icon.icns');
  if (existsSync(icns)) cpSync(icns, join(resDir, 'icon.icns'));
}

function createDmg() {
  mkdirSync(dirname(dmgPath), { recursive: true });
  if (existsSync(dmgPath)) rmSync(dmgPath);
  execSync(
    `hdiutil create -volname "${productName}" -srcfolder "${appPath}" -ov -format UDZO "${dmgPath}"`,
    { stdio: 'inherit' }
  );
}

async function main() {
  log(`打包 ${productName} v${version}（Chrome 独立窗口 · ${targetArch}）…`);

  stageAppFiles();
  stageNodeRuntime(await downloadNodeRuntime());
  writeInfoPlist();
  writeLauncher();
  createDmg();

  const appSizeMb = (getDirSize(appPath) / (1024 * 1024)).toFixed(1);
  const dmgSizeMb = (statSync(dmgPath).size / (1024 * 1024)).toFixed(1);

  const seedDb = join(seedDir, 'ledger.db');
  let txnHint = '';
  if (existsSync(seedDb)) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(seedDb, { readOnly: true });
      const n = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
      db.close();
      txnHint = `，种子数据 ${n} 笔`;
    } catch { /* ignore */ }
  }

  log(`\n完成 → ${dmgPath}`);
  log(`  DMG ${dmgSizeMb} MB · 安装后约 ${appSizeMb} MB${txnHint}`);
  log(`  需要本机已安装 Google Chrome`);
  log(`  应用 → ${appPath}`);
}

function getDirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) total += getDirSize(p);
    else total += statSync(p).size;
  }
  return total;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
