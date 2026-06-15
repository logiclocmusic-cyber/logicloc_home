import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readState, writeState, mergeTransactions, resetLedger, deleteImportBatchById, changeImportBatchSource, getStats } from './db.js';
import { initAuth, login, logout, getUserFromToken, parseAuthHeader } from './auth.js';
import { scanInvoiceImage, getAiStatus, normalizeInvoiceFields } from './deepseek.js';
import {
  listInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice,
  saveInvoiceFile, INVOICE_DIR
} from './invoices.js';

initAuth();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEAR_IMG_DIR = process.env.GEAR_IMG_DIR || join(__dirname, '..', 'data', 'gear-images');
mkdirSync(GEAR_IMG_DIR, { recursive: true });
const PORT = Number(process.env.PORT) || 3001;
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
app.use('/invoice-files', express.static(INVOICE_DIR));

function requireAuth(req, res, next) {
  const token = parseAuthHeader(req);
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = user;
  req.token = token;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ...getStats() });
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
    const stateVersion = writeState(req.body, { expectedVersion });
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
    const { data, mime } = req.body || {};
    if (!data) return res.status(400).json({ error: '请上传发票图片' });
    const raw = String(data).replace(/^data:[^;]+;base64,/, '');
    const result = await scanInvoiceImage(raw, mime || 'image/jpeg');
    res.json({
      ...normalizeInvoiceFields(result.parsed, { sourceText: result.ocrText || '' }),
      rawAi: result.raw
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

if (isProd && serveStatic) {
  const dist = join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server http://0.0.0.0:${PORT}`);
  if (isProd && serveStatic) console.log('Serving production build from dist/');
  if (isProd && !serveStatic) console.log('API-only mode (frontend hosted separately)');
});
