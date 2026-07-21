import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FAMILY_EVENT_DIR = process.env.FAMILY_EVENT_DIR
  || join(__dirname, '..', 'data', 'family-events');
mkdirSync(FAMILY_EVENT_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS family_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    notes TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

function parseImages(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function rowToEvent(row) {
  if (!row) return null;
  const images = parseImages(row.images);
  return {
    id: row.id,
    title: row.title || '',
    eventDate: row.event_date || '',
    notes: row.notes || '',
    images: images.map(name => ({
      name,
      url: `/family-event-files/${name}`,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function imageExt(mime = '', fileName = '') {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  const fromName = String(fileName || '').match(/\.([a-z0-9]+)$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return 'jpg';
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
  const info = db.prepare(`
    INSERT INTO family_events (title, event_date, notes, images)
    VALUES (?, ?, ?, '[]')
  `).run(title, eventDate, notes);
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

  let imageNames = existing.images.map(img => img.name);
  if ('images' in data && Array.isArray(data.images)) {
    imageNames = data.images.map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  }

  db.prepare(`
    UPDATE family_events
    SET title = ?, event_date = ?, notes = ?, images = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, eventDate, notes, JSON.stringify(imageNames), id);

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

export function saveFamilyEventImage(eventId, buf, mime = '', fileName = '') {
  const existing = getFamilyEvent(eventId);
  if (!existing) {
    const err = new Error('事件不存在');
    err.status = 404;
    throw err;
  }
  if (!Buffer.isBuffer(buf) || !buf.length) {
    const err = new Error('无效图片');
    err.status = 400;
    throw err;
  }
  if (buf.length > 8 * 1024 * 1024) {
    const err = new Error('单张图片不能超过 8MB');
    err.status = 400;
    throw err;
  }
  if (existing.images.length >= 12) {
    const err = new Error('每个事件最多 12 张图片');
    err.status = 400;
    throw err;
  }

  const ext = imageExt(mime, fileName);
  const name = `${eventId}-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`;
  writeFileSync(join(FAMILY_EVENT_DIR, name), buf);

  const names = [...existing.images.map(img => img.name), name];
  db.prepare(`
    UPDATE family_events
    SET images = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(names), eventId);

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
  const names = existing.images.map(img => img.name).filter(n => n !== name);
  db.prepare(`
    UPDATE family_events
    SET images = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(names), eventId);
  return getFamilyEvent(eventId);
}
