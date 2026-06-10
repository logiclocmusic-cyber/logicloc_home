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
  db.prepare(`
    UPDATE company_invoices SET
      vendor = ?, buyer = ?, invoice_no = ?, invoice_date = ?,
      amount = ?, tax_amount = ?, total = ?, category = ?,
      items = ?, notes = ?, status = ?, file_path = ?, file_name = ?, mime_type = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.vendor ?? existing.vendor,
    data.buyer ?? existing.buyer,
    data.invoiceNo ?? existing.invoiceNo,
    data.invoiceDate ?? existing.invoiceDate,
    data.amount ?? existing.amount,
    data.taxAmount ?? existing.taxAmount,
    data.total ?? existing.total,
    data.category ?? existing.category,
    JSON.stringify(data.items ?? existing.items),
    data.notes ?? existing.notes,
    data.status ?? existing.status,
    data.filePath ?? (existing.fileUrl ? existing.fileUrl.replace('/invoice-files/', '') : null),
    data.fileName ?? existing.fileName,
    data.mimeType ?? existing.mimeType,
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
