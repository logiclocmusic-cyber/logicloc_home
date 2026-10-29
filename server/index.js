import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import { ZipArchive } from 'archiver';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { readState, writeState, mergeTransactions, resetLedger, deleteImportBatchById, changeImportBatchSource, getStats, readMeta, writeMeta, DB_PATH } from './db.js';
import { publish, subscribe, setEditor, publishPresence } from './live.js';
import { initAuth, login, loginWithPin, logout, getUserFromToken, parseAuthHeader } from './auth.js';
import { scanInvoiceImage, scanInvoiceOcr, getAiStatus, normalizeInvoiceFields, invoiceReviewWarnings } from './deepseek.js';
import {
  listInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice,
  saveInvoiceFile, getInvoiceArchiveFiles, INVOICE_DIR
} from './invoices.js';
import {
  listFamilyEvents, getFamilyEvent, createFamilyEvent, updateFamilyEvent,
  deleteFamilyEvent, saveFamilyEventImage, removeFamilyEventImage, FAMILY_EVENT_DIR,
  getFamilyEventStorageStats,
} from './family-events.js';

initAuth();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEAR_IMG_DIR = process.env.GEAR_IMG_DIR || join(__dirname, '..', 'data', 'gear-images');
const TRAVEL_IMG_DIR = process.env.TRAVEL_IMG_DIR || join(__dirname, '..', 'data', 'travel-images');
const TRAVEL_FILE_DIR = process.env.TRAVEL_FILE_DIR || join(__dirname, '..', 'data', 'travel-files');
mkdirSync(GEAR_IMG_DIR, { recursive: true });
mkdirSync(TRAVEL_IMG_DIR, { recursive: true });
mkdirSync(TRAVEL_FILE_DIR, { recursive: true });
mkdirSync(FAMILY_EVENT_DIR, { recursive: true });
const PORT = Number(process.env.PORT) || 3001;
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    return String(pkg.version || '').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
const isProd = process.env.NODE_ENV === 'production';
const serveStatic = process.env.SERVE_STATIC !== 'false';

function normalizeOrigin(url) {
  if (!url) return '';
  const s = url.trim().replace(/\/+$/, '');
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).origin;
  } catch {
    return s;
  }
}

const corsOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const o = normalizeOrigin(origin);
  if (!corsOrigins.length) return true;
  if (corsOrigins.includes(o)) return true;
  // 允许同一 Vercel 项目的预览域名（如 logicloc-home-xxx.vercel.app）
  for (const allowed of corsOrigins) {
    try {
      const host = new URL(allowed).hostname;
      const oh = new URL(o).hostname;
      if (host.endsWith('.vercel.app') && oh.endsWith('.vercel.app')) {
        const prefix = host.split('-')[0];
        if (oh.startsWith(prefix)) return true;
      }
    } catch { /* skip */ }
  }
  return false;
}

const app = express();
app.use(cors(corsOrigins.length
  ? {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) callback(null, true);
      else {
        console.warn('[cors] blocked origin:', origin, 'allowed:', corsOrigins.join(', '));
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }
  : {}));
app.use(express.json({ limit: '50mb' }));
app.use('/gear-images', express.static(GEAR_IMG_DIR));
app.use('/travel-images', express.static(TRAVEL_IMG_DIR));
app.use('/travel-files', (req, res, next) => {
  const raw = typeof req.query.name === 'string' ? req.query.name : '';
  const fileName = normalizeTravelFileName(raw);
  if (fileName) {
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  }
  next();
}, express.static(TRAVEL_FILE_DIR));
app.use('/invoice-files', express.static(INVOICE_DIR));
app.use('/family-event-files', (req, res, next) => {
  const raw = typeof req.query.name === 'string' ? req.query.name : '';
  const fileName = raw.split(/[/\\]/).pop().replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  if (fileName && /\.(pdf|csv|xls|xlsx)$/i.test(fileName)) {
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    const disposition = /\.pdf$/i.test(fileName) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  }
  next();
}, express.static(FAMILY_EVENT_DIR));

function requireAuth(req, res, next) {
  const token = parseAuthHeader(req);
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = user;
  req.token = token;
  next();
}

function getLanUrls(port) {
  const urls = new Set();
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.add(`http://${net.address}:${port}`);
      }
    }
  }
  return [...urls];
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ...getStats(),
    port: PORT,
    mobileUrls: getLanUrls(PORT),
    auth: 'pin',
    version: APP_VERSION
  });
});

app.post('/api/auth/pin', (req, res) => {
  const { pin } = req.body || {};
  const result = loginWithPin(pin);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '请输入邮箱和密码' });
  const result = login(email, password);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json(result);
});

app.post('/api/auth/logout', (req, res) => {
  logout(parseAuthHeader(req));
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromToken(parseAuthHeader(req));
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ user });
});

function liveOrigin(req) {
  return String(req.get('x-ledger-client') || '').slice(0, 64);
}

function pushLive(req, event) {
  publish({ ...event, origin: liveOrigin(req) });
}

app.get('/api/state/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`: ${' '.repeat(2048)}\n\n`);
  const version = Number(readMeta('stateVersion')) || 0;
  res.write(`data: ${JSON.stringify({ topic: 'ledger', stateVersion: version })}\n\n`);
  const stop = subscribe(res, liveOrigin(req));
  publishPresence();
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    stop();
  });
});

app.post('/api/state/presence', requireAuth, (req, res) => {
  const editing = !!req.body?.editing;
  const page = editing ? req.body?.page : '';
  setEditor(liveOrigin(req), page);
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (_req, res) => {
  try {
    res.json(readState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/state', requireAuth, (req, res) => {
  try {
    const expectedVersion = req.body.stateVersion;
    const stateVersion = writeState(req.body, {
      expectedVersion,
      keepGroupsWhenEmpty: req.get('x-ledger-sync') !== '1'
    });
    pushLive(req, { topic: 'ledger', stateVersion });
    res.json({ ok: true, stateVersion });
  } catch (err) {
    if (err.code === 'STATE_CONFLICT') {
      return res.status(409).json({
        error: '数据已被其他设备更新，请刷新后重试',
        currentVersion: err.currentVersion
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/import-batches/:batchId', requireAuth, (req, res) => {
  try {
    const batchId = decodeURIComponent(req.params.batchId || '');
    if (!batchId) return res.status(400).json({ error: '缺少批次 ID' });
    const result = deleteImportBatchById(batchId);
    pushLive(req, { topic: 'ledger', stateVersion: result.stateVersion });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/import-batches/:batchId/source', requireAuth, (req, res) => {
  try {
    const batchId = decodeURIComponent(req.params.batchId || '');
    const source = req.body?.source;
    if (!batchId) return res.status(400).json({ error: '缺少批次 ID' });
    if (!source || !String(source).trim()) return res.status(400).json({ error: '请选择新来源' });
    const result = changeImportBatchSource(batchId, source);
    pushLive(req, { topic: 'ledger', stateVersion: result.stateVersion });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset-ledger', requireAuth, (req, res) => {
  try {
    if (req.body?.confirm !== 'RESET_ALL_TRANSACTIONS') {
      return res.status(400).json({ error: '需要确认参数 confirm: RESET_ALL_TRANSACTIONS' });
    }
    const result = resetLedger();
    pushLive(req, { topic: 'ledger', stateVersion: result.stateVersion });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/merge-transactions', requireAuth, (req, res) => {
  try {
    const rows = req.body?.transactions;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'transactions 必须为数组' });
    }
    const result = mergeTransactions(rows);
    pushLive(req, { topic: 'ledger', stateVersion: result.stateVersion });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices', requireAuth, (_req, res) => {
  try {
    res.json({ invoices: listInvoices() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices/archive', requireAuth, (req, res) => {
  try {
    const files = getInvoiceArchiveFiles(req.body?.ids);
    if (!files.length) return res.status(400).json({ error: '当前筛选结果中没有可下载的发票文件' });

    let archiveName = String(req.body?.archiveName || '发票').trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .slice(0, 100) || '发票';
    if (!archiveName.toLowerCase().endsWith('.zip')) archiveName += '.zip';
    const ascii = archiveName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '') || 'invoices.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`);

    const zip = new ZipArchive({ zlib: { level: 9 } });
    zip.on('warning', err => console.warn('[invoice archive]', err.message));
    zip.on('error', err => {
      console.error('[invoice archive]', err);
      if (!res.headersSent) res.status(500).json({ error: '打包发票失败' });
      else res.destroy(err);
    });
    zip.pipe(res);
    for (const file of files) zip.file(file.path, { name: file.name });
    zip.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/ai-status', requireAuth, (_req, res) => {
  res.json(getAiStatus());
});

app.get('/api/invoices/:id', requireAuth, (req, res) => {
  const invoice = getInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: '发票不存在' });
  res.json(invoice);
});

app.post('/api/invoices/scan', requireAuth, async (req, res) => {
  try {
    const { data, mime, fileName } = req.body || {};
    if (!data) return res.status(400).json({ error: '请上传发票图片' });
    const raw = String(data).replace(/^data:[^;]+;base64,/, '');
    let result;
    let aiFallbackMessage = '';
    try {
      result = await scanInvoiceImage(raw, mime || 'image/jpeg', { fileName });
    } catch (aiError) {
      console.warn('[invoice-scan] AI failed, using OCR fallback:', aiError.message);
      result = await scanInvoiceOcr(raw, mime || 'image/jpeg', { fileName });
      aiFallbackMessage = 'AI 识别失败，已改用 OCR 提取，请重点核对';
    }
    const normalized = normalizeInvoiceFields(result.parsed, { sourceText: result.ocrText || '' });
    res.json({
      ...normalized,
      rawAi: result.raw,
      recognitionMode: result.mode,
      warnings: [
        ...(aiFallbackMessage ? [aiFallbackMessage] : []),
        ...invoiceReviewWarnings(normalized),
      ]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', requireAuth, (req, res) => {
  try {
    const { data, mime, fileName, rawAi, ...fields } = req.body || {};
    const normalized = normalizeInvoiceFields(fields);
    let invoice = createInvoice({ ...normalized, rawAi });
    if (data) {
      const saved = saveInvoiceFile(invoice.id, data, mime, fileName);
      invoice = updateInvoice(invoice.id, {
        filePath: saved.filename,
        fileName: fileName || saved.filename,
        mimeType: saved.mime
      });
    }
    pushLive(req, { topic: 'invoices' });
    res.json(invoice);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message, duplicate: err.duplicate });
    res.status(500).json({ error: err.message });
  }
});

const INVOICE_NORMALIZE_KEYS = new Set([
  'vendor', 'buyer', 'seller', 'invoiceNo', 'invoice_no', 'invoiceDate', 'invoice_date',
  'amount', 'taxAmount', 'tax_amount', 'total', 'category', 'items', 'notes'
]);

app.put('/api/invoices/:id', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    let patch = { ...body };
    if (Object.keys(body).some(k => INVOICE_NORMALIZE_KEYS.has(k))) {
      patch = { ...patch, ...normalizeInvoiceFields(body) };
    }
    const invoice = updateInvoice(Number(req.params.id), patch);
    if (!invoice) return res.status(404).json({ error: '发票不存在' });
    pushLive(req, { topic: 'invoices' });
    res.json(invoice);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message, duplicate: err.duplicate });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', requireAuth, (req, res) => {
  try {
    if (!deleteInvoice(Number(req.params.id))) {
      return res.status(404).json({ error: '发票不存在' });
    }
    pushLive(req, { topic: 'invoices' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/family-events/storage', requireAuth, (_req, res) => {
  try {
    res.json(getFamilyEventStorageStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/family-events', requireAuth, (_req, res) => {
  try {
    res.json({ events: listFamilyEvents() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/family-events/:id', requireAuth, (req, res) => {
  const event = getFamilyEvent(Number(req.params.id));
  if (!event) return res.status(404).json({ error: '事件不存在' });
  res.json(event);
});

app.post('/api/family-events', requireAuth, (req, res) => {
  try {
    const event = createFamilyEvent(req.body || {});
    pushLive(req, { topic: 'family' });
    res.json(event);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/family-events/:id', requireAuth, (req, res) => {
  try {
    const event = updateFamilyEvent(Number(req.params.id), req.body || {});
    if (!event) return res.status(404).json({ error: '事件不存在' });
    pushLive(req, { topic: 'family' });
    res.json(event);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/family-events/:id', requireAuth, (req, res) => {
  try {
    if (!deleteFamilyEvent(Number(req.params.id))) {
      return res.status(404).json({ error: '事件不存在' });
    }
    pushLive(req, { topic: 'family' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/family-events/:id/images', requireAuth, (req, res) => {
  try {
    const { data, mime, fileName, category, note, starred } = req.body || {};
    if (!data) return res.status(400).json({ error: '无文件数据' });
    const raw = String(data).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    const event = saveFamilyEventImage(Number(req.params.id), buf, mime, fileName, category, note, starred);
    pushLive(req, { topic: 'family' });
    res.json(event);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function normalizeTravelFileName(raw) {
  let base = String(raw || '').split(/[/\\]/).pop() || '';
  base = base.replace(/[\u0000-\u001f]/g, '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!base) return '';
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  if (base.length > 120) base = `${base.slice(0, 116).replace(/\.pdf$/i, '')}.pdf`;
  return base;
}

function normalizeTravelFile(value) {
  const path = String(value || '').trim().split('?')[0];
  if (!path.startsWith('/travel-files/') || path.includes('..') || path.includes('\\')) return '';
  const name = path.slice('/travel-files/'.length);
  if (!/^[\w.-]+\.pdf$/i.test(name)) return '';
  return path;
}

function normalizeTravelImage(value) {
  const path = String(value || '').trim().split('?')[0];
  if (!path.startsWith('/travel-images/') || path.includes('..') || path.includes('\\')) return '';
  const name = path.slice('/travel-images/'.length);
  if (!/^[\w.-]+$/.test(name)) return '';
  return path;
}

function normalizeTravelFiles(raw) {
  const out = [];
  const seen = new Set();
  const add = (stored, fileName) => {
    const path = String(stored || '').trim().split('?')[0];
    const name = path.startsWith('/travel-files/') ? path.slice('/travel-files/'.length) : path.split(/[/\\]/).pop();
    if (!name || seen.has(name) || !/^[\w.-]+\.pdf$/i.test(name)) return;
    seen.add(name);
    out.push({ name, fileName: normalizeTravelFileName(fileName) || '文件.pdf' });
  };
  if (Array.isArray(raw?.files)) raw.files.slice(0, 8).forEach(entry => add(entry?.name || entry?.url, entry?.fileName));
  if (!out.length) add(raw?.file, raw?.fileName);
  return out.slice(0, 8);
}

function normalizeTravelItem(raw) {
  const costRaw = raw?.cost;
  let cost = null;
  if (costRaw !== '' && costRaw != null) {
    const n = Number(costRaw);
    if (Number.isFinite(n)) cost = Math.round(n * 100) / 100;
  }
  const files = normalizeTravelFiles(raw);
  const currency = String(raw?.currency || '').trim().toUpperCase() === 'HKD' ? 'HKD' : 'CNY';
  return {
    id: String(raw?.id || '').trim().slice(0, 40),
    date: String(raw?.date || '').trim().slice(0, 40),
    time: String(raw?.time || '').trim().slice(0, 8),
    event: String(raw?.event || '').trim().slice(0, 80),
    note: String(raw?.note || '').trim().slice(0, 400),
    image: normalizeTravelImage(raw?.image),
    location: String(raw?.location || '').trim().slice(0, 500),
    destination: String(raw?.destination || '').trim().slice(0, 500),
    files,
    file: files[0] ? `/travel-files/${files[0].name}` : '',
    fileName: files[0]?.fileName || '',
    cost,
    currency,
    category: ['交通', '住宿', '用餐', '景点', '购物', '任务'].includes(String(raw?.category || '').trim()) ? String(raw.category).trim() : '',
    visit: raw?.visit === true || raw?.visit === 1 || raw?.visit === '1',
    done: !(raw?.visit === true || raw?.visit === 1 || raw?.visit === '1') && (raw?.done === true || raw?.done === 1 || raw?.done === '1'),
  };
}

function mapsUrlAllowed(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co') return true;
  if (/^maps\.google\./.test(host)) return true;
  return /^google\./.test(host) && url.pathname.startsWith('/maps');
}

async function expandMapsUrl(start) {
  let current = String(start || '').trim();
  if (!mapsUrlAllowed(current)) {
    const err = new Error('仅支持 Google 地图链接');
    err.status = 400;
    throw err;
  }
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, current).href;
    if (!mapsUrlAllowed(next)) break;
    current = next;
  }
  return current;
}

const GEO_PATH = join(dirname(DB_PATH), 'travel-geocode.json');
const geoDisk = new Map();
const geoMem = new Map();
try {
  const saved = JSON.parse(readFileSync(GEO_PATH, 'utf8'));
  if (saved && typeof saved === 'object') {
    for (const [key, value] of Object.entries(saved)) {
      if (value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))) {
        geoDisk.set(key, { lat: Number(value.lat), lng: Number(value.lng) });
      }
    }
  }
} catch { /* 还没有定位缓存 */ }
let geoWriteTimer = null;
function scheduleGeoSave() {
  clearTimeout(geoWriteTimer);
  geoWriteTimer = setTimeout(() => {
    try { writeFileSync(GEO_PATH, JSON.stringify(Object.fromEntries(geoDisk))); } catch { /* 缓存写失败不影响行程 */ }
  }, 400);
}
function coordsFromMapsText(value) {
  const text = String(value || '');
  const pin = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const pair = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!pair) return null;
  const lat = Number(pair[1]);
  const lng = Number(pair[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function nearPoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
const SIMP_TRAD = {
  铜: '銅', 锣: '鑼', 湾: '灣', 环: '環', 号: '號', 码: '碼', 头: '頭',
  龙: '龍', 园: '園', 维: '維', 亚: '亞', 兴: '興', 发: '發', 广: '廣',
  场: '場', 门: '門', 东: '東', 铁: '鐵', 国: '國', 际: '際', 机: '機',
  恒: '恆', 岛: '島', 屿: '嶼',
};
const LOCAL_FOCUS = { lat: 22.30, lng: 114.17 };
const LOCAL_BOX = { south: 22.15, west: 113.82, north: 22.58, east: 114.45 };
const KNOWN_PLACES = new Map([
  ['铜锣湾站', { lat: 22.28015, lng: 114.18490 }],
  ['旺角站', { lat: 22.31935, lng: 114.16945 }],
  ['佐敦站', { lat: 22.30485, lng: 114.17172 }],
  ['中环七号码头', { lat: 22.28707, lng: 114.16120 }],
  ['尖沙咀天星码头', { lat: 22.29352, lng: 114.16798 }],
  ['铜锣湾百德新街恒隆中心', { lat: 22.28026, lng: 114.18594 }],
  ['旺角亚皆老街8号朗豪坊', { lat: 22.31825, lng: 114.16861 }],
  ['尖沙咀柯士甸道22号九龙公园', { lat: 22.30053, lng: 114.17012 }],
  ['铜锣湾告士打道311号皇室堡', { lat: 22.28040, lng: 114.18646 }],
  ['铜锣湾兴发街1号维多利亚公园', { lat: 22.28240, lng: 114.18878 }],
  ['湾仔港湾道18号中环广场', { lat: 22.28006, lng: 114.17364 }],
]);
function toTraditional(text) {
  return [...String(text || '')].map(ch => SIMP_TRAD[ch] || ch).join('');
}
function namesAnotherRegion(query) {
  return /成都|成渝|深圳|蛇口|广州|廣州|澳门|澳門|上海|北京|重庆|重慶|宁波|寧波|台湾|台灣|江门|江門|苗栗/.test(String(query || ''));
}
function inLocalRegion(point) {
  return point.lat >= LOCAL_BOX.south && point.lat <= LOCAL_BOX.north
    && point.lng >= LOCAL_BOX.west && point.lng <= LOCAL_BOX.east;
}
function knownPlace(query) {
  const text = String(query || '').trim();
  return KNOWN_PLACES.get(text) || null;
}
function distinctiveTokens(query) {
  const text = toTraditional(String(query || '').replace(/https?:\/\/\S+/g, ' '));
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const latin = (text.match(/[A-Za-z][A-Za-z0-9üöäßÜÖÄ]{3,}/g) || []).map(token => token.toLowerCase());
  const generic = new Set(['香港', '成都', '深圳', '中国', '餐厅', '酒店', '广场', '中心', '国际机场', 'cafe', 'hotel', 'house', 'center', 'park', 'restaurant', 'station']);
  return [...cjk, ...latin].filter(token => !generic.has(token));
}
function placeNameMatches(query, name) {
  const tokens = distinctiveTokens(query);
  if (!tokens.length) return false;
  const hay = toTraditional(name).toLowerCase();
  const hayTokens = distinctiveTokens(name);
  return tokens.some(token => {
    const left = token.toLowerCase();
    if (hay.includes(left)) return true;
    return hayTokens.some(part => {
      const right = part.toLowerCase();
      const shorter = Math.min(left.length, right.length);
      const longer = Math.max(left.length, right.length);
      return shorter >= 2 && shorter / longer >= 0.6 && (left.includes(right) || right.includes(left));
    });
  });
}
function rememberGeo(query, point) {
  geoDisk.set(query, point);
  geoMem.set(query, point);
  scheduleGeoSave();
}
function forgetGeo(query) {
  if (!geoDisk.has(query) && !geoMem.has(query)) return;
  geoDisk.delete(query);
  geoMem.delete(query);
  scheduleGeoSave();
}
let lastNominatimAt = 0;
async function nominatimCandidates(query, local) {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
  const box = local ? '&viewbox=113.82,22.58,114.45,22.15&bounded=1' : '';
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query.slice(0, 180))}${box}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'LocHome/1.0 (family travel map)',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!res.ok) return [];
  const list = await res.json();
  if (!Array.isArray(list)) return [];
  return list.map(hit => ({
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    name: hit.display_name || '',
  })).filter(hit => Number.isFinite(hit.lat) && Number.isFinite(hit.lng));
}
async function photonCandidates(query, near) {
  const params = new URLSearchParams({ q: query.slice(0, 180), limit: '5' });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'LocHome/1.0 (family travel map)',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map(feature => {
    const coords = feature?.geometry?.coordinates;
    const props = feature?.properties || {};
    return {
      lat: Number(coords?.[1]),
      lng: Number(coords?.[0]),
      name: [props.name, props.street, props.city, props.state].filter(Boolean).join(' '),
    };
  }).filter(hit => Number.isFinite(hit.lat) && Number.isFinite(hit.lng));
}
function landmarkOf(text) {
  const trad = toTraditional(text);
  const district = '香港|九龍|新界|銅鑼灣|旺角|尖沙咀|佐敦|灣仔|中環|上環|金鐘|北角|堅尼地城|西營盤|紅磡|土瓜灣|大角咀';
  let rest = trad.replace(new RegExp(`^(?:${district})`), '');
  rest = rest.replace(/[\u4e00-\u9fff]{1,10}[路街道巷]\d*號?/, '');
  rest = rest.replace(/^\d*號?/, '').trim();
  const name = (rest.match(/[\u4e00-\u9fff]{2,}/g) || []).join('');
  if (name.length < 2 || name === trad) return '';
  return name;
}
function searchVariants(query) {
  const text = String(query || '').trim();
  const stripped = text.replace(/\s*[（(][^）)]*[）)]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const variants = [stripped || text];
  const trad = toTraditional(stripped);
  if (trad && trad !== stripped) variants.push(trad);
  const cjk = (stripped.match(/[\u4e00-\u9fff]{2,}/g) || []).join('');
  const latin = (stripped.match(/[A-Za-z][A-Za-z0-9üöäßÜÖÄ'’-]+/g) || []).join(' ');
  if (cjk && cjk !== stripped && cjk !== trad) variants.push(cjk);
  if (latin && latin !== stripped) variants.push(latin);
  const landmark = landmarkOf(stripped);
  if (landmark) variants.push(landmark);
  return [...new Set(variants.filter(item => item.length >= 2))].slice(0, 4);
}
function cacheFits(query, point, anchor) {
  if (!point) return false;
  const elsewhere = namesAnotherRegion(query);
  if (!elsewhere && !inLocalRegion(point)) return false;
  if (!anchor || elsewhere) return true;
  return haversineKm(point, anchor) <= 80;
}
function chooseCandidate(query, candidates, near) {
  const elsewhere = namesAnotherRegion(query);
  const pool = elsewhere ? candidates : candidates.filter(hit => inLocalRegion(hit));
  const matched = pool.filter(hit => placeNameMatches(query, hit.name));
  if (!matched.length) return null;
  const ranked = near
    ? [...matched].sort((a, b) => haversineKm(a, near) - haversineKm(b, near))
    : matched;
  const best = ranked[0];
  if (near && haversineKm(best, near) > (elsewhere ? 1600 : 80)) return null;
  return { lat: best.lat, lng: best.lng };
}
async function locateTravelPlace(query, near) {
  const known = knownPlace(query);
  if (known) {
    rememberGeo(query, known);
    return known;
  }
  const anchor = nearPoint(near);
  const elsewhere = namesAnotherRegion(query);
  const focus = anchor || (elsewhere ? null : LOCAL_FOCUS);
  if (geoMem.has(query)) {
    const cached = geoMem.get(query);
    if (cacheFits(query, cached, anchor)) return cached;
    if (!cached && !anchor) return null;
  }
  if (geoDisk.has(query)) {
    const cached = geoDisk.get(query);
    if (cacheFits(query, cached, anchor)) {
      geoMem.set(query, cached);
      return cached;
    }
    forgetGeo(query);
  }
  const direct = coordsFromMapsText(query);
  if (direct) {
    rememberGeo(query, direct);
    return direct;
  }
  if (mapsUrlAllowed(query)) {
    try {
      const point = coordsFromMapsText(await expandMapsUrl(query));
      if (point) {
        rememberGeo(query, point);
        return point;
      }
    } catch { /* 短链接解析失败时改用地名 */ }
  }
  let point = null;
  const variants = searchVariants(query);
  for (const variant of variants) {
    try {
      point = chooseCandidate(query, await nominatimCandidates(variant, !elsewhere), focus);
    } catch { /* 地名库暂时不可用 */ }
    if (point) break;
  }
  if (!point) {
    for (const variant of variants) {
      try {
        point = chooseCandidate(query, await photonCandidates(variant, focus), focus);
      } catch { /* 备用地名库暂时不可用 */ }
      if (point) break;
    }
  }
  if (point) rememberGeo(query, point);
  else geoMem.set(query, null);
  return point;
}

app.post('/api/travel/geocode', requireAuth, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.places) ? req.body.places : null;
    const items = rawItems
      ? rawItems.map(item => ({ query: String(item?.query || '').trim(), near: nearPoint(item?.near) }))
      : (Array.isArray(req.body?.queries) ? req.body.queries.map(query => ({ query: String(query || '').trim(), near: null })) : []);
    const unique = [];
    const seen = new Set();
    for (const item of items) {
      if (!item.query || seen.has(item.query)) continue;
      seen.add(item.query);
      unique.push(item);
      if (unique.length >= 40) break;
    }
    const places = {};
    for (const item of unique) places[item.query] = await locateTravelPlace(item.query, item.near);
    res.json({ places });
  } catch (err) {
    res.status(500).json({ error: err.message || '定位失败' });
  }
});

app.post('/api/travel/resolve-maps', requireAuth, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 2) : [];
    const urls = {};
    for (const raw of list) {
      const key = String(raw || '').trim();
      if (!key || urls[key]) continue;
      urls[key] = await expandMapsUrl(key);
    }
    res.json({ urls });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || '地图链接无法解析' });
  }
});

function emptyTravelBags() {
  return [
    { id: 'bag-1', name: '背包1', items: [] },
    { id: 'bag-2', name: '背包2', items: [] },
  ];
}

function normalizeTravelBags(raw) {
  const source = Array.isArray(raw) ? raw : [];
  return emptyTravelBags().map((bag, index) => {
    const found = source.find(row => row?.id === bag.id) || source[index] || {};
    const seen = new Set();
    const items = [];
    const rows = Array.isArray(found.items) ? found.items : [];
    for (const row of rows.slice(0, 80)) {
      let name = String(row?.name || '').trim().slice(0, 60);
      let group = String(row?.group || '').trim().slice(0, 20);
      if (!group && name.includes('：')) {
        const splitAt = name.indexOf('：');
        const head = name.slice(0, splitAt).trim().slice(0, 20);
        const rest = name.slice(splitAt + 1).trim().slice(0, 60);
        if (head && rest) {
          group = head;
          name = rest;
        }
      }
      if (!name) continue;
      let id = String(row?.id || '').replace(/[^\w-]/g, '').slice(0, 40);
      if (!id || seen.has(id)) id = `bagitem-${index}-${items.length}`;
      seen.add(id);
      items.push({
        id,
        name,
        group,
        done: row?.done === true || row?.done === 1 || row?.done === '1',
      });
    }
    return { ...bag, items };
  });
}

function normalizeTravelHkdRate(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null;
  return Math.round(n * 100000) / 100000;
}

function normalizeTravelPlan(raw, index) {
  const items = Array.isArray(raw?.items)
    ? raw.items.slice(0, 200).map(normalizeTravelItem).filter(item => item.id)
    : [];
  const id = String(raw?.id || '').replace(/[^\w-]/g, '').slice(0, 40) || `plan-${index + 1}`;
  const hkdRate = normalizeTravelHkdRate(raw?.hkdRate);
  const hkdRateDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.hkdRateDate || '').trim())
    ? String(raw.hkdRateDate).trim()
    : '';
  return {
    id,
    title: String(raw?.title || '').trim().slice(0, 40) || '新的旅行',
    range: String(raw?.range || '').trim().slice(0, 40),
    items,
    bags: Array.isArray(raw?.bags) ? normalizeTravelBags(raw.bags) : emptyTravelBags(),
    hkdRate,
    hkdRateDate,
  };
}

function normalizeTravelDoc(raw, previous) {
  const prevPlans = Array.isArray(previous?.plans) ? previous.plans : [];
  if (raw && Array.isArray(raw.plans)) {
    const plans = [];
    const seen = new Set();
    raw.plans.slice(0, 30).forEach((plan, index) => {
      const next = normalizeTravelPlan(plan, index);
      if (!next.id || seen.has(next.id)) return;
      seen.add(next.id);
      if (!Array.isArray(plan?.bags)) {
        const prev = prevPlans.find(row => row.id === next.id);
        if (Array.isArray(prev?.bags)) next.bags = normalizeTravelBags(prev.bags);
      }
      plans.push(next);
    });
    const activeId = plans.some(plan => plan.id === raw.activeId) ? raw.activeId : (plans[0]?.id || '');
    return { activeId, plans };
  }
  if (raw && Array.isArray(raw.items)) {
    const plan = normalizeTravelPlan({
      id: 'plan-hk-20261011',
      title: '10月11日香港旅游',
      range: raw.range || '10月11日 – 10月15日',
      items: raw.items,
    }, 0);
    return { activeId: plan.id, plans: [plan] };
  }
  return { activeId: '', plans: [] };
}

app.get('/api/travel', requireAuth, (req, res) => {
  const raw = readMeta('travelItinerary');
  res.json({
    itinerary: normalizeTravelDoc(raw),
    legacy: !(raw && Array.isArray(raw.plans)),
  });
});

app.put('/api/travel', requireAuth, (req, res) => {
  try {
    const itinerary = normalizeTravelDoc(req.body || {}, readMeta('travelItinerary'));
    if (!itinerary.plans.length) return res.status(400).json({ error: '无效行程' });
    writeMeta('travelItinerary', itinerary);
    pushLive(req, { topic: 'travel' });
    res.json({ itinerary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/travel/:id/image-from-url', requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: '请提供图片链接' });
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: '链接格式无效' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: '仅支持 http/https 链接' });
    }
    const safeId = String(req.params.id).replace(/[^\w-]/g, '').slice(0, 40);
    if (!safeId) return res.status(400).json({ error: '无效事项' });
    const { buf, contentType } = await fetchRemoteGearImageBuffer(url);
    const ext = gearImageExt(buf, contentType);
    const filename = `${safeId}.${ext}`;
    for (const oldExt of ['jpg', 'png', 'webp', 'gif']) {
      if (oldExt === ext) continue;
      try { unlinkSync(join(TRAVEL_IMG_DIR, `${safeId}.${oldExt}`)); } catch { /* ignore */ }
    }
    writeFileSync(join(TRAVEL_IMG_DIR, filename), buf);
    res.json({ url: `/travel-images/${filename}` });
  } catch (err) {
    if (err.message === '获取图片超时') return res.status(408).json({ error: err.message });
    const status = /无效|不是有效图片|不能超过/.test(err.message) ? 400 : 502;
    res.status(status).json({ error: err.message || '获取图片失败' });
  }
});

app.post('/api/travel/:id/file', requireAuth, (req, res) => {
  try {
    const { data, fileName } = req.body || {};
    if (!data) return res.status(400).json({ error: '无文件数据' });
    const raw = String(data).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return res.status(400).json({ error: '无效文件' });
    if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'PDF 不能超过 15MB' });
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: '仅支持 PDF 文件' });
    const safeId = String(req.params.id).replace(/[^\w-]/g, '').slice(0, 40);
    if (!safeId) return res.status(400).json({ error: '无效事项' });
    const name = normalizeTravelFileName(fileName) || '文件.pdf';
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const filename = `${safeId}-${suffix}.pdf`;
    writeFileSync(join(TRAVEL_FILE_DIR, filename), buf);
    res.json({ url: `/travel-files/${filename}`, name: filename, fileName: name });
  } catch (err) {
    res.status(500).json({ error: err.message || '上传失败' });
  }
});

app.delete('/api/travel/:id/file/:name', requireAuth, (req, res) => {
  try {
    const safeId = String(req.params.id).replace(/[^\w-]/g, '').slice(0, 40);
    const filename = String(req.params.name || '');
    const owned = filename === `${safeId}.pdf` || filename.startsWith(`${safeId}-`);
    if (!safeId || !owned || !/^[\w.-]+\.pdf$/i.test(filename)) {
      return res.status(400).json({ error: '无效文件' });
    }
    try { unlinkSync(join(TRAVEL_FILE_DIR, filename)); } catch { /* 文件可能已经不存在 */ }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

app.delete('/api/family-events/:id/images/:name', requireAuth, (req, res) => {
  try {
    const event = removeFamilyEventImage(Number(req.params.id), decodeURIComponent(req.params.name));
    if (!event) return res.status(404).json({ error: '事件不存在' });
    pushLive(req, { topic: 'family' });
    res.json(event);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/gear/:id/image', requireAuth, (req, res) => {
  try {
    const { data, mime } = req.body || {};
    if (!data) return res.status(400).json({ error: '无图片数据' });
    const raw = String(data).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return res.status(400).json({ error: '无效图片' });
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: '图片不能超过 5MB' });
    const ext = mime?.includes('png') ? 'png' : mime?.includes('webp') ? 'webp' : 'jpg';
    const filename = `${req.params.id}.${ext}`;
    writeFileSync(join(GEAR_IMG_DIR, filename), buf);
    res.json({ url: `/gear-images/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function gearImageExt(buf, contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return 'jpg';
}

function looksLikeImageBuffer(buf, contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return true;
  if (!buf?.length) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49) return true;
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return true;
  return false;
}

function gearFetchReferers(parsed) {
  const host = parsed.hostname.toLowerCase();
  const refs = [`${parsed.origin}/`];
  if (host.includes('alicdn') || host.includes('tbcdn') || host.includes('taobao')) {
    refs.push('https://www.taobao.com/', 'https://item.taobao.com/');
  }
  if (host.includes('360buyimg') || host.includes('jd.com') || host.includes('jd.hk')) {
    refs.push('https://www.jd.com/', 'https://item.jd.com/');
  }
  if (host.includes('pinduoduo') || host.includes('yangkeduo')) {
    refs.push('https://mobile.yangkeduo.com/');
  }
  refs.push('');
  return [...new Set(refs)];
}

async function fetchRemoteGearImageBuffer(rawUrl) {
  const url = rawUrl.trim();
  const parsed = new URL(url);
  const referers = gearFetchReferers(parsed);
  let lastErr = null;

  for (const referer of referers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
      if (referer) headers.Referer = referer;
      const response = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' });
      if (!response.ok) {
        lastErr = new Error(`获取图片失败 (${response.status})`);
        continue;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (!buf.length) {
        lastErr = new Error('图片为空');
        continue;
      }
      if (buf.length > 5 * 1024 * 1024) throw new Error('图片不能超过 5MB');
      const contentType = response.headers.get('content-type') || '';
      if (!looksLikeImageBuffer(buf, contentType)) {
        lastErr = new Error('链接不是有效图片，请右键商品图选择「复制图片地址」后粘贴');
        continue;
      }
      return { buf, contentType };
    } catch (err) {
      if (err.message === '图片不能超过 5MB') throw err;
      lastErr = err.name === 'AbortError' ? new Error('获取图片超时') : err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error('获取图片失败');
}

app.post('/api/gear/:id/image-from-url', requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: '请提供图片链接' });
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: '链接格式无效' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: '仅支持 http/https 链接' });
    }
    const { buf, contentType } = await fetchRemoteGearImageBuffer(url);
    const ext = gearImageExt(buf, contentType);
    const filename = `${req.params.id}.${ext}`;
    writeFileSync(join(GEAR_IMG_DIR, filename), buf);
    res.json({ url: `/gear-images/${filename}` });
  } catch (err) {
    if (err.message === '获取图片超时') return res.status(408).json({ error: err.message });
    res.status(err.message?.includes('有效图片') ? 400 : 500).json({ error: err.message || '获取图片失败' });
  }
});

if (isProd && serveStatic) {
  const dist = process.env.DIST_DIR || join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
}

const host = process.env.LISTEN_HOST || '0.0.0.0';
const httpServer = app.listen(PORT, host, () => {
  console.log(`API server http://${host}:${PORT}`);
  if (isProd && serveStatic) console.log('Serving production build from', process.env.DIST_DIR || join(__dirname, '..', 'dist'));
  if (isProd && !serveStatic) console.log('API-only mode (frontend hosted separately)');
});
httpServer.on('error', (err) => {
  console.error('API listen failed:', err);
  process.exit(1);
});
