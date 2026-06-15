import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INVOICE_DIR = process.env.INVOICE_DIR || join(__dirname, '..', 'data', 'invoices');
mkdirSync(INVOICE_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS company_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT,
    buyer TEXT,
    invoice_no TEXT,
    invoice_date TEXT,
    amount REAL,
    tax_amount REAL,
    total REAL,
    category TEXT DEFAULT '其他',
    items TEXT,
    notes TEXT,
    status TEXT DEFAULT 'confirmed',
    file_path TEXT,
    file_name TEXT,
    mime_type TEXT,
    raw_ai TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

try { db.exec('ALTER TABLE company_invoices ADD COLUMN printed INTEGER DEFAULT 0'); } catch { /* exists */ }

export function normalizeInvoiceNo(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function findInvoiceByNo(invoiceNo, excludeId = null) {
  const key = normalizeInvoiceNo(invoiceNo);
  if (!key) return null;
  const rows = db.prepare(`
    SELECT * FROM company_invoices
    WHERE invoice_no IS NOT NULL AND TRIM(invoice_no) != ''
  `).all();
  for (const row of rows) {
    if (excludeId != null && row.id === excludeId) continue;
    if (normalizeInvoiceNo(row.invoice_no) === key) return rowToInvoice(row);
  }
  return null;
}

export function formatDuplicateInvoiceMessage(inv) {
  const no = inv?.invoiceNo || '—';
  const extras = [];
  if (inv?.vendor) extras.push(`销售方：${inv.vendor}`);
  if (inv?.invoiceDate) extras.push(`开票日期：${inv.invoiceDate}`);
  const tail = extras.length ? `（${extras.join('，')}）` : '';
  return `发票号码 ${no} 已上传过${tail}，请勿重复上传。`;
}

function assertInvoiceNoUnique(invoiceNo, excludeId = null) {
  const dup = findInvoiceByNo(invoiceNo, excludeId);
  if (!dup) return;
  const err = new Error(formatDuplicateInvoiceMessage(dup));
  err.status = 409;
  err.duplicate = dup;
  throw err;
}

function rowToInvoice(row) {
  if (!row) return null;
  let items = [];
  try { items = row.items ? JSON.parse(row.items) : []; } catch { items = []; }
  return {
    id: row.id,
    vendor: row.vendor || '',
    buyer: row.buyer || '',
    invoiceNo: row.invoice_no || '',
    invoiceDate: row.invoice_date || '',
    amount: row.amount,
    taxAmount: row.tax_amount,
    total: row.total,
    category: row.category || '其他',
    items,
    notes: row.notes || '',
    status: row.status || 'confirmed',
    printed: !!row.printed,
    fileUrl: row.file_path ? `/invoice-files/${row.file_path}` : null,
    fileName: row.file_name || '',
    mimeType: row.mime_type || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listInvoices() {
  const rows = db.prepare('SELECT * FROM company_invoices ORDER BY invoice_date DESC, id DESC').all();
  return rows.map(rowToInvoice);
}

export function getInvoice(id) {
  const row = db.prepare('SELECT * FROM company_invoices WHERE id = ?').get(id);
  return rowToInvoice(row);
}

function extFromMime(mime) {
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('pdf')) return 'pdf';
  return 'jpg';
}

export function saveInvoiceFile(id, base64, mime, fileName) {
  const raw = String(base64).replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('无效文件');
  if (buf.length > 10 * 1024 * 1024) throw new Error('文件不能超过 10MB');
  const ext = extname(fileName || '')?.slice(1) || extFromMime(mime);
  const filename = `${id}.${ext}`;
  writeFileSync(join(INVOICE_DIR, filename), buf);
  return { filename, mime: mime || `image/${ext}` };
}

export function createInvoice(data) {
  assertInvoiceNoUnique(data.invoiceNo);
  const stmt = db.prepare(`
    INSERT INTO company_invoices (
      vendor, buyer, invoice_no, invoice_date, amount, tax_amount, total,
      category, items, notes, status, file_path, file_name, mime_type, raw_ai
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    data.vendor || null,
    data.buyer || null,
    data.invoiceNo || null,
    data.invoiceDate || null,
    data.amount ?? null,
    data.taxAmount ?? null,
    data.total ?? null,
    data.category || '其他',
    JSON.stringify(data.items || []),
    data.notes || null,
    data.status || 'confirmed',
    data.filePath || null,
    data.fileName || null,
    data.mimeType || null,
    data.rawAi || null
  );
  return getInvoice(info.lastInsertRowid);
}

export function updateInvoice(id, data) {
  const existing = getInvoice(id);
  if (!existing) return null;
  if ('invoiceNo' in data) assertInvoiceNoUnique(data.invoiceNo, id);
  const existingFilePath = existing.fileUrl ? existing.fileUrl.replace('/invoice-files/', '') : null;
  db.prepare(`
    UPDATE company_invoices SET
      vendor = ?, buyer = ?, invoice_no = ?, invoice_date = ?,
      amount = ?, tax_amount = ?, total = ?, category = ?,
      items = ?, notes = ?, status = ?, printed = ?, file_path = ?, file_name = ?, mime_type = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    'vendor' in data ? data.vendor : existing.vendor,
    'buyer' in data ? data.buyer : existing.buyer,
    'invoiceNo' in data ? data.invoiceNo : existing.invoiceNo,
    'invoiceDate' in data ? data.invoiceDate : existing.invoiceDate,
    'amount' in data ? data.amount : existing.amount,
    'taxAmount' in data ? data.taxAmount : existing.taxAmount,
    'total' in data ? data.total : existing.total,
    'category' in data ? data.category : existing.category,
    JSON.stringify('items' in data ? data.items : existing.items),
    'notes' in data ? data.notes : existing.notes,
    'status' in data ? data.status : existing.status,
    'printed' in data ? (data.printed ? 1 : 0) : (existing.printed ? 1 : 0),
    'filePath' in data ? data.filePath : existingFilePath,
    'fileName' in data ? data.fileName : existing.fileName,
    'mimeType' in data ? data.mimeType : existing.mimeType,
    id
  );
  return getInvoice(id);
}

export function deleteInvoice(id) {
  const row = db.prepare('SELECT file_path FROM company_invoices WHERE id = ?').get(id);
  if (!row) return false;
  if (row.file_path) {
    const fp = join(INVOICE_DIR, row.file_path);
    if (existsSync(fp)) unlinkSync(fp);
  }
  db.prepare('DELETE FROM company_invoices WHERE id = ?').run(id);
  return true;
}

export { INVOICE_DIR };
