import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FAMILY_EVENT_DIR = process.env.FAMILY_EVENT_DIR
  || join(__dirname, '..', 'data', 'family-events');
mkdirSync(FAMILY_EVENT_DIR, { recursive: true });

const FAMILY_EVENT_STORAGE_LIMIT_MB = Math.max(
  1,
  Number(process.env.FAMILY_EVENT_STORAGE_LIMIT_MB) || 1024
);

db.exec(`
  CREATE TABLE IF NOT EXISTS family_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    notes TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    linked_txn_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

try {
  const cols = db.prepare('PRAGMA table_info(family_events)').all();
  if (!cols.some(c => c.name === 'linked_txn_ids')) {
    db.exec(`ALTER TABLE family_events ADD COLUMN linked_txn_ids TEXT NOT NULL DEFAULT '[]'`);
  }
} catch { /* ignore migration errors */ }

function parseLinkedTxnIds(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list)
      ? list.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeLinkedTxnIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const x of ids) {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.slice(0, 50);
}

function normalizeImageCategory(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

function normalizeImageNote(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function normalizeImageStarred(raw) {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function normalizeFamilyFileName(raw) {
  let base = String(raw || '').split(/[/\\]/).pop() || '';
  base = base.replace(/[\u0000-\u001f]/g, '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!base) return '';
  if (!/\.(pdf|csv|xls|xlsx)$/i.test(base)) return '';
  return base.slice(0, 120);
}

function familyStoredFileKind(name) {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(csv|xls|xlsx)$/i.test(name)) return 'spreadsheet';
  return 'image';
}

function normalizeImageRecord(raw) {
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, category: '', note: '', starred: false, fileName: '' } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  return {
    name,
    category: normalizeImageCategory(raw.category),
    note: normalizeImageNote(raw.note),
    starred: normalizeImageStarred(raw.starred),
    fileName: familyStoredFileKind(name) !== 'image' ? normalizeFamilyFileName(raw.fileName) : '',
  };
}

function imageMeta(img) {
  return {
    name: img.name,
    category: img.category || '',
    note: img.note || '',
    starred: !!img.starred,
    fileName: img.fileName || '',
  };
}

function parseImages(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list.map(normalizeImageRecord).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeImages(images) {
  return JSON.stringify((images || []).map(img => {
    const category = img.category || '';
    const note = img.note || '';
    const starred = !!img.starred;
    const fileName = img.fileName || '';
    if (!category && !note && !starred && !fileName) return img.name;
    const rec = { name: img.name };
    if (category) rec.category = category;
    if (note) rec.note = note;
    if (starred) rec.starred = true;
    if (fileName) rec.fileName = fileName;
    return rec;
  }));
}

function rowToEvent(row) {
  if (!row) return null;
  const images = parseImages(row.images);
  return {
    id: row.id,
    title: row.title || '',
    eventDate: row.event_date || '',
    notes: row.notes || '',
    images: images.map(img => ({
      name: img.name,
      kind: familyStoredFileKind(img.name),
      category: img.category || '',
      note: img.note || '',
      starred: !!img.starred,
      fileName: img.fileName || '',
      url: `/family-event-files/${img.name}${img.fileName ? `?name=${encodeURIComponent(img.fileName)}` : ''}`,
    })),
    linkedTxnIds: parseLinkedTxnIds(row.linked_txn_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function familyFileExt(mime = '', fileName = '') {
  const m = String(mime || '').toLowerCase();
  const fromName = String(fileName || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
  if (m === 'application/pdf' || fromName === 'pdf') return 'pdf';
  if (m === 'text/csv' || m === 'application/csv' || fromName === 'csv') return 'csv';
  if (m === 'application/vnd.ms-excel' || fromName === 'xls') return 'xls';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || fromName === 'xlsx') return 'xlsx';
  if (m.includes('png') || fromName === 'png') return 'png';
  if (m.includes('webp') || fromName === 'webp') return 'webp';
  if (m.includes('gif') || fromName === 'gif') return 'gif';
  if (m.includes('heic') || m.includes('heif') || fromName === 'heic' || fromName === 'heif') return 'heic';
  if (m.startsWith('image/') || fromName === 'jpg' || fromName === 'jpeg') return 'jpg';
  return '';
}

function unlinkImage(name) {
  if (!name) return;
  const fp = join(FAMILY_EVENT_DIR, name);
  if (existsSync(fp)) {
    try { unlinkSync(fp); } catch { /* ignore */ }
  }
}

export function listFamilyEvents() {
  const rows = db.prepare(
    'SELECT * FROM family_events ORDER BY event_date DESC, id DESC'
  ).all();
  return rows.map(rowToEvent);
}

export function getFamilyEventStorageStats() {
  let totalBytes = 0;
  let fileCount = 0;
  try {
    for (const name of readdirSync(FAMILY_EVENT_DIR)) {
      if (name.startsWith('.')) continue;
      const fp = join(FAMILY_EVENT_DIR, name);
      try {
        const st = statSync(fp);
        if (st.isFile()) {
          totalBytes += st.size;
          fileCount += 1;
        }
      } catch { /* skip unreadable file */ }
    }
  } catch { /* empty or missing dir */ }

  const limitBytes = FAMILY_EVENT_STORAGE_LIMIT_MB * 1024 * 1024;
  const percent = limitBytes > 0 ? Math.min(100, (totalBytes / limitBytes) * 100) : 0;
  return {
    totalBytes,
    fileCount,
    limitBytes,
    limitMb: FAMILY_EVENT_STORAGE_LIMIT_MB,
    percent,
  };
}

export function getFamilyEvent(id) {
  const row = db.prepare('SELECT * FROM family_events WHERE id = ?').get(id);
  return rowToEvent(row);
}

export function createFamilyEvent(data = {}) {
  const title = String(data.title || '').trim();
  const eventDate = String(data.eventDate || '').trim();
  if (!title) {
    const err = new Error('请填写事件标题');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const err = new Error('请填写有效日期（YYYY-MM-DD）');
    err.status = 400;
    throw err;
  }
  const notes = String(data.notes || '').trim();
  const linkedTxnIds = normalizeLinkedTxnIds(data.linkedTxnIds);
  const info = db.prepare(`
    INSERT INTO family_events (title, event_date, notes, images, linked_txn_ids)
    VALUES (?, ?, ?, '[]', ?)
  `).run(title, eventDate, notes, JSON.stringify(linkedTxnIds));
  return getFamilyEvent(info.lastInsertRowid);
}

export function updateFamilyEvent(id, data = {}) {
  const existing = getFamilyEvent(id);
  if (!existing) return null;

  const title = 'title' in data ? String(data.title || '').trim() : existing.title;
  const eventDate = 'eventDate' in data ? String(data.eventDate || '').trim() : existing.eventDate;
  const notes = 'notes' in data ? String(data.notes || '').trim() : existing.notes;

  if (!title) {
    const err = new Error('请填写事件标题');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const err = new Error('请填写有效日期（YYYY-MM-DD）');
    err.status = 400;
    throw err;
  }

  let images = existing.images.map(imageMeta);
  if ('images' in data && Array.isArray(data.images)) {
    const prev = new Map(images.map(img => [img.name, img]));
    images = data.images.map(raw => {
      const rec = normalizeImageRecord(raw);
      if (!rec) return null;
      const old = prev.get(rec.name);
      const explicit = (key) => raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, key);
      if (old && !explicit('category')) rec.category = old.category || '';
      if (old && !explicit('note')) rec.note = old.note || '';
      if (old && !explicit('starred')) rec.starred = !!old.starred;
      if (old && !explicit('fileName')) rec.fileName = old.fileName || '';
      return rec;
    }).filter(Boolean);
  }

  let linkedTxnIds = existing.linkedTxnIds;
  if ('linkedTxnIds' in data) {
    linkedTxnIds = normalizeLinkedTxnIds(data.linkedTxnIds);
  }

  db.prepare(`
    UPDATE family_events
    SET title = ?, event_date = ?, notes = ?, images = ?, linked_txn_ids = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, eventDate, notes, serializeImages(images), JSON.stringify(linkedTxnIds), id);

  return getFamilyEvent(id);
}

export function deleteFamilyEvent(id) {
  const existing = getFamilyEvent(id);
  if (!existing) return false;
  existing.images.forEach(img => unlinkImage(img.name));
  // cleanup any leftover files for this event id
  try {
    for (const name of readdirSync(FAMILY_EVENT_DIR)) {
      if (name.startsWith(`${id}-`)) unlinkImage(name);
    }
  } catch { /* ignore */ }
  db.prepare('DELETE FROM family_events WHERE id = ?').run(id);
  return true;
}

export function saveFamilyEventImage(eventId, buf, mime = '', fileName = '', category = '', note = '', starred = false) {
  const existing = getFamilyEvent(eventId);
  if (!existing) {
    const err = new Error('事件不存在');
    err.status = 404;
    throw err;
  }
  if (!Buffer.isBuffer(buf) || !buf.length) {
    const err = new Error('无效文件');
    err.status = 400;
    throw err;
  }
  if (buf.length > 8 * 1024 * 1024) {
    const err = new Error('单个文件不能超过 8MB');
    err.status = 400;
    throw err;
  }
  if (existing.images.length >= 12) {
    const err = new Error('每个事件最多 12 个文件');
    err.status = 400;
    throw err;
  }

  const ext = familyFileExt(mime, fileName);
  if (!ext) {
    const err = new Error('仅支持图片、PDF、CSV 或 Excel 文件');
    err.status = 400;
    throw err;
  }
  const name = `${eventId}-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`;
  writeFileSync(join(FAMILY_EVENT_DIR, name), buf);

  const images = [
    ...existing.images.map(imageMeta),
    {
      name,
      category: normalizeImageCategory(category),
      note: normalizeImageNote(note),
      starred: normalizeImageStarred(starred),
      fileName: ['pdf', 'csv', 'xls', 'xlsx'].includes(ext) ? normalizeFamilyFileName(fileName) : '',
    },
  ];
  db.prepare(`
    UPDATE family_events
    SET images = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(serializeImages(images), eventId);

  return getFamilyEvent(eventId);
}

export function removeFamilyEventImage(eventId, imageName) {
  const existing = getFamilyEvent(eventId);
  if (!existing) return null;
  const name = String(imageName || '').trim();
  if (!name || name.includes('/') || name.includes('..')) {
    const err = new Error('无效图片名');
    err.status = 400;
    throw err;
  }
  if (!existing.images.some(img => img.name === name)) {
    const err = new Error('图片不存在');
    err.status = 404;
    throw err;
  }
  unlinkImage(name);
  const images = existing.images
    .filter(img => img.name !== name)
    .map(imageMeta);
  db.prepare(`
    UPDATE family_events
    SET images = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(serializeImages(images), eventId);
  return getFamilyEvent(eventId);
}
