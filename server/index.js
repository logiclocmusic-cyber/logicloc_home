import express from 'express';
import cors from 'cors';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readState, writeState, getStats } from './db.js';
import { initAuth, login, logout, getUserFromToken, parseAuthHeader } from './auth.js';
import { scanInvoiceImage } from './deepseek.js';
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

const corsOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors(corsOrigins.length
  ? { origin: corsOrigins, credentials: true }
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
    writeState(req.body);
    res.json({ ok: true });
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
    const p = result.parsed;
    res.json({
      vendor: p.vendor || '',
      buyer: p.buyer || '',
      invoiceNo: p.invoiceNo || p.invoice_no || '',
      invoiceDate: p.invoiceDate || p.invoice_date || '',
      amount: p.amount ?? null,
      taxAmount: p.taxAmount ?? p.tax_amount ?? null,
      total: p.total ?? null,
      category: p.category || '其他',
      items: p.items || [],
      notes: p.notes || '',
      rawAi: result.raw
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', requireAuth, (req, res) => {
  try {
    const { data, mime, fileName, rawAi, ...fields } = req.body || {};
    let invoice = createInvoice({ ...fields, rawAi });
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
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/invoices/:id', requireAuth, (req, res) => {
  try {
    const invoice = updateInvoice(Number(req.params.id), req.body || {});
    if (!invoice) return res.status(404).json({ error: '发票不存在' });
    res.json(invoice);
  } catch (err) {
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
