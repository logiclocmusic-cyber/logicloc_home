const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { spawn, execFile } = require('child_process');

const APP_NAME = "Loc's Home";
let mainWindow = null;
let serverProc = null;
let serverPort = null;
let serverLogPath = null;

function devAppRoot() {
  return path.join(__dirname, '..');
}

function packagedPaths() {
  const distDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
  return {
    appRoot: app.getAppPath(),
    serverCwd: process.resourcesPath,
    serverEntry: path.join(app.getAppPath(), 'server', 'index.js'),
    distDir: fs.existsSync(distDir) ? distDir : path.join(app.getAppPath(), 'dist')
  };
}

function resolvePaths() {
  if (!app.isPackaged) {
    const root = devAppRoot();
    return {
      appRoot: root,
      serverCwd: root,
      serverEntry: path.join(root, 'server', 'index.js'),
      distDir: path.join(root, 'dist')
    };
  }
  return packagedPaths();
}

function userDataRoot() {
  return path.join(app.getPath('userData'), 'data');
}

function ensureDataDirs() {
  const root = userDataRoot();
  for (const sub of ['gear-images', 'invoices', 'family-events', 'tesseract-cache']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }

  const dbPath = path.join(root, 'ledger.db');
  if (!fs.existsSync(dbPath)) {
    const seed = path.join(process.resourcesPath, 'seed', 'ledger.db');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, dbPath);
  }

  const configPath = path.join(app.getPath('userData'), 'config.env');
  if (!fs.existsSync(configPath)) {
    const sample = [
      '# Loc\'s Home 本地配置（AI 发票识别）',
      '# 硅基流动（推荐，国内）：https://cloud.siliconflow.cn/account/ak',
      'DEEPSEEK_VISION_API_BASE=https://api.siliconflow.cn',
      'DEEPSEEK_VISION_MODEL=Qwen/Qwen3.5-9B',
      'DEEPSEEK_VISION_API_KEY=',
      '',
      '# 或使用 Gemini：https://aistudio.google.com/apikey',
      '# GEMINI_API_KEY=',
      '# GEMINI_MODEL=gemini-2.5-flash-lite',
      '',
    ].join('\n');
    try { fs.writeFileSync(configPath, sample, 'utf8'); } catch (_) { /* ignore */ }
  }

  return root;
}

function appendServerLog(text) {
  if (!serverLogPath) return;
  try { fs.appendFileSync(serverLogPath, text); } catch (_) { /* ignore */ }
}

function tailServerLog(max = 1200) {
  if (!serverLogPath || !fs.existsSync(serverLogPath)) return '';
  try {
    const text = fs.readFileSync(serverLogPath, 'utf8');
    return text.length > max ? text.slice(-max) : text;
  } catch (_) {
    return '';
  }
}

function findFreePort(start = 37123) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once('error', () => {
        if (port > start + 50) resolve(start);
        else tryPort(port + 1);
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

function waitForServer(port, attempts = 60) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tick = () => {
      const req = net.connect(port, '127.0.0.1', () => {
        req.end();
        resolve();
      });
      req.on('error', () => {
        left -= 1;
        if (left <= 0) {
          const log = tailServerLog();
          reject(new Error(log ? `本地服务启动超时\n\n${log}` : '本地服务启动超时'));
        } else {
          setTimeout(tick, 250);
        }
      });
    };
    tick();
  });
}

function startServer(port, dataRoot) {
  const { serverCwd, serverEntry, distDir } = resolvePaths();
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`找不到服务入口：${serverEntry}`);
  }
  if (!fs.existsSync(distDir)) {
    throw new Error(`找不到前端资源：${distDir}`);
  }

  serverLogPath = path.join(app.getPath('userData'), 'server.log');
  try { fs.writeFileSync(serverLogPath, ''); } catch (_) { /* ignore */ }
  const configPath = path.join(app.getPath('userData'), 'config.env');

  const proc = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      SERVE_STATIC: 'true',
      LISTEN_HOST: '0.0.0.0',
      LOCAL_PIN: '5281',
      PORT: String(port),
      DIST_DIR: distDir,
      DB_PATH: path.join(dataRoot, 'ledger.db'),
      GEAR_IMG_DIR: path.join(dataRoot, 'gear-images'),
      INVOICE_DIR: path.join(dataRoot, 'invoices'),
      FAMILY_EVENT_DIR: path.join(dataRoot, 'family-events'),
      TESSERACT_CACHE: path.join(dataRoot, 'tesseract-cache'),
      APP_CONFIG_PATH: configPath,
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.on('error', (err) => {
    if (!app.isQuitting) dialog.showErrorBox(APP_NAME, err.message || String(err));
  });
  proc.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[api] ${text}`);
    appendServerLog(text);
  });
  proc.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[api] ${text}`);
    appendServerLog(text);
  });
  proc.on('exit', (code) => {
    if (code && code !== 0 && !app.isQuitting) {
      const log = tailServerLog();
      dialog.showErrorBox(
        APP_NAME,
        `后台服务异常退出（${code}）${log ? `\n\n${log}` : ''}`
      );
    }
  });
  return proc;
}

function stopServer() {
  if (!serverProc) return;
  serverProc.kill('SIGTERM');
  serverProc = null;
}

const CALENDAR_NAME = "Loc's Home 提醒";
const CALENDAR_ALARMS_DAYS = [30, 7, 1];

function escapeAppleScriptString(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildReminderAppleScript(name, expiry) {
  const [y, m, d] = String(expiry).split('-').map(Number);
  const safeName = escapeAppleScriptString(name);
  const safeCal = escapeAppleScriptString(CALENDAR_NAME);
  const alarmLines = CALENDAR_ALARMS_DAYS.map(days =>
    `      make new display alarm at end of display alarms with properties {trigger interval:-(${days} * days)}`
  ).join('\n');
  return `
tell application "Calendar"
  if not (exists calendar "${safeCal}") then
    make new calendar with properties {name:"${safeCal}"}
  end if
  tell calendar "${safeCal}"
    set sDate to current date
    set year of sDate to ${y}
    set month of sDate to ${m}
    set day of sDate to ${d}
    set hours of sDate to 9
    set minutes of sDate to 0
    set seconds of sDate to 0
    set eDate to sDate + (1 * hours)
    set ev to make new event with properties {summary:"${safeName}", start date:sDate, end date:eDate, description:"Loc's Home 长期提醒 · 有效期 ${y}年${m}月${d}日"}
    tell ev
${alarmLines}
    end tell
  end tell
end tell
`.trim();
}

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message || 'AppleScript 执行失败'));
      else resolve(stdout);
    });
  });
}

function buildReminderIcsMain({ id, name, expiry }) {
  const iso = String(expiry || '').trim();
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
  const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const alarms = [90, 30, 7, 1, 0].map(days => {
    const trigger = days === 0 ? 'PT0S' : `-P${days}D`;
    const label = days === 0 ? `${name} 今天到期` : `${name} 还有 ${days} 天到期`;
    return `BEGIN:VALARM\r\nTRIGGER:${trigger}\r\nACTION:DISPLAY\r\nDESCRIPTION:${esc(label)}\r\nEND:VALARM`;
  }).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loc\'s Home//长期提醒//ZH',
    'BEGIN:VEVENT',
    `UID:reminder-${id || iso}@logicloc.home`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${iso.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${esc(name)}`,
    `DESCRIPTION:${esc(`Loc's Home 长期提醒 · 有效期 ${y}年${m}月${d}日`)}`,
    alarms,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

async function addReminderToMacCalendar({ id, name, expiry }) {
  if (process.platform !== 'darwin') {
    throw new Error('加入系统日历仅支持 macOS');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry || ''))) {
    throw new Error('无效的有效期');
  }
  try {
    await runAppleScript(buildReminderAppleScript(name, expiry));
    return { mode: 'calendar', calendar: CALENDAR_NAME };
  } catch (err) {
    const ics = buildReminderIcsMain({ id, name, expiry });
    const safeName = String(name || 'reminder').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    const icsPath = path.join(os.tmpdir(), `loc-home-${safeName}-${Date.now()}.ics`);
    fs.writeFileSync(icsPath, ics, 'utf8');
    const openErr = await shell.openPath(icsPath);
    if (openErr) throw err;
    return { mode: 'ics', path: icsPath };
  }
}

ipcMain.handle('calendar:add-reminder', async (_evt, payload) => addReminderToMacCalendar(payload || {}));

ipcMain.handle('app:open-config', async () => {
  const configPath = path.join(app.getPath('userData'), 'config.env');
  if (!fs.existsSync(configPath)) {
    const sample = [
      '# Loc\'s Home 本地配置（AI 发票识别）',
      '# 硅基流动：https://cloud.siliconflow.cn/account/ak',
      'DEEPSEEK_VISION_API_BASE=https://api.siliconflow.cn',
      'DEEPSEEK_VISION_MODEL=Qwen/Qwen3.5-9B',
      'DEEPSEEK_VISION_API_KEY=',
      '',
      '# 或 Gemini：',
      '# GEMINI_API_KEY=',
      '# GEMINI_MODEL=gemini-2.5-flash-lite',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, sample, 'utf8');
  }
  shell.showItemInFolder(configPath);
  return { path: configPath };
});

async function createWindow() {
  const dataRoot = ensureDataDirs();
  serverPort = await findFreePort();
  serverProc = startServer(serverPort, dataRoot);
  await waitForServer(serverPort);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.isQuitting = false;

app.whenReady().then(createWindow).catch((err) => {
  dialog.showErrorBox(APP_NAME, err.message || String(err));
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow().catch((err) => {
    dialog.showErrorBox(APP_NAME, err.message || String(err));
  });
});
