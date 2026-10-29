#!/usr/bin/env node
/** 从 Railway 拉取账本 state + 家庭事件/图片 + 装备图 + 公司发票 */
import { writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_ROOT = process.env.PULL_DATA_ROOT || join(ROOT, 'data');
const BACKUP_JSON = process.env.PULL_BACKUP_JSON || join(DATA_ROOT, 'last-cloud-pull.json');

process.env.DB_PATH = join(DATA_ROOT, 'ledger.db');
process.env.FAMILY_EVENT_DIR = join(DATA_ROOT, 'family-events');
process.env.INVOICE_DIR = join(DATA_ROOT, 'invoices');
process.env.GEAR_IMG_DIR = join(DATA_ROOT, 'gear-images');

mkdirSync(DATA_ROOT, { recursive: true });
mkdirSync(process.env.FAMILY_EVENT_DIR, { recursive: true });
mkdirSync(process.env.INVOICE_DIR, { recursive: true });
mkdirSync(process.env.GEAR_IMG_DIR, { recursive: true });

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

const { readState, writeState } = await import('../server/db.js');

function eventKey(ev) {
  return `${String(ev.eventDate || '').trim()}|${String(ev.title || '').trim()}`;
}

async function login() {
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`登录失败: ${await loginRes.text()}`);
  const { token } = await loginRes.json();
  return { token, headers: { Authorization: `Bearer ${token}` } };
}

async function downloadBinary(url, dest, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`下载为空 ${url}`);
  writeFileSync(dest, buf);
  return buf;
}

async function syncFamilyEvents(events, headers) {
  const {
    listFamilyEvents, createFamilyEvent, updateFamilyEvent, deleteFamilyEvent,
  } = await import('../server/family-events.js');
  const dir = process.env.FAMILY_EVENT_DIR;

  const local = listFamilyEvents();
  const localByKey = new Map(local.map(ev => [eventKey(ev), ev]));
  const cloudKeys = new Set();
  let created = 0, updated = 0, images = 0, removed = 0;

  for (const ev of events) {
    const key = eventKey(ev);
    cloudKeys.add(key);
    let localEv = localByKey.get(key);
    const imageNames = (ev.images || []).map(img => img.name).filter(Boolean);

    if (!localEv) {
      localEv = createFamilyEvent({
        title: ev.title,
        eventDate: ev.eventDate,
        notes: ev.notes,
        linkedTxnIds: ev.linkedTxnIds,
      });
      created++;
    } else {
      updateFamilyEvent(localEv.id, {
        title: ev.title,
        eventDate: ev.eventDate,
        notes: ev.notes,
        linkedTxnIds: ev.linkedTxnIds,
        images: imageNames,
      });
      updated++;
    }

    for (const img of ev.images || []) {
      const dest = join(dir, img.name);
      if (!existsSync(dest)) {
        await downloadBinary(`${API_BASE}/family-event-files/${encodeURIComponent(img.name)}`, dest, headers);
        images++;
      }
    }
    updateFamilyEvent(localEv.id, { images: imageNames });
  }

  for (const ev of local) {
    if (!cloudKeys.has(eventKey(ev))) {
      deleteFamilyEvent(ev.id);
      removed++;
    }
  }

  return { created, updated, images, removed, total: events.length };
}

async function syncInvoices(cloudInvoices, headers) {
  const {
    listInvoices, createInvoice, updateInvoice, findInvoiceByNo, saveInvoiceFile,
  } = await import('../server/invoices.js');

  let created = 0, updated = 0, files = 0, skipped = 0;

  for (const inv of cloudInvoices) {
    const payload = {
      vendor: inv.vendor,
      buyer: inv.buyer,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      amount: inv.amount,
      taxAmount: inv.taxAmount,
      total: inv.total,
      category: inv.category,
      items: inv.items,
      notes: inv.notes,
      status: inv.status,
      printed: inv.printed,
      fileName: inv.fileName,
      mimeType: inv.mimeType,
    };

    let localInv = inv.invoiceNo ? findInvoiceByNo(inv.invoiceNo) : null;
    if (!localInv) {
      localInv = createInvoice({ ...payload, filePath: null, rawAi: null });
      created++;
    } else {
      updateInvoice(localInv.id, payload);
      updated++;
    }

    if (!inv.fileUrl) {
      skipped++;
      continue;
    }

    const existingRel = localInv.fileUrl?.replace(/^\/invoice-files\//, '') || '';
    const existingAbs = existingRel ? join(process.env.INVOICE_DIR, existingRel) : '';
    if (existingAbs && existsSync(existingAbs)) {
      skipped++;
      continue;
    }

    const buf = await downloadBinary(`${API_BASE}${inv.fileUrl}`, join(process.env.INVOICE_DIR, '_tmp_dl'), headers);
    try {
      const saved = saveInvoiceFile(
        localInv.id,
        `data:${inv.mimeType || 'application/octet-stream'};base64,${buf.toString('base64')}`,
        inv.mimeType,
        inv.fileName || existingRel || `invoice-${localInv.id}`,
      );
      updateInvoice(localInv.id, {
        filePath: saved.filename,
        fileName: inv.fileName || saved.filename,
        mimeType: saved.mime,
      });
      files++;
    } finally {
      try { rmSync(join(process.env.INVOICE_DIR, '_tmp_dl')); } catch { /* ignore */ }
    }
  }

  return { created, updated, files, skipped, total: cloudInvoices.length, local: listInvoices().length };
}

async function syncGearImages(gearLibrary, headers) {
  const dir = process.env.GEAR_IMG_DIR;
  let downloaded = 0, skipped = 0;

  for (const gear of gearLibrary || []) {
    const img = gear?.image;
    if (!img || typeof img !== 'string' || img.startsWith('data:')) {
      skipped++;
      continue;
    }
    const name = img.replace(/^.*\/gear-images\//, '').replace(/^\//, '');
    if (!name || name.includes('..')) continue;
    const dest = join(dir, name);
    if (existsSync(dest)) {
      skipped++;
      continue;
    }
    await downloadBinary(`${API_BASE}/gear-images/${encodeURIComponent(name)}`, dest, headers);
    downloaded++;
  }

  return { downloaded, skipped };
}

function mirrorDir(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst)) rmSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

function checkpointDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
}

function copySqliteDb(src, dst) {
  checkpointDb(src);
  if (existsSync(dst)) rmSync(dst);
  for (const ext of ['-wal', '-shm']) {
    try { rmSync(dst + ext); } catch { /* ignore */ }
  }
  const ro = new DatabaseSync(src, { readOnly: true });
  try {
    const escaped = dst.replace(/'/g, "''");
    ro.exec(`VACUUM INTO '${escaped}'`);
  } finally { ro.close(); }
}

function syncToMacApp() {
  const macRoot = join(homedir(), "Library/Application Support/Loc's Home/data");
  if (!existsSync(join(homedir(), 'Library/Application Support'))) return false;
  mkdirSync(macRoot, { recursive: true });

  const dbSrc = join(DATA_ROOT, 'ledger.db');
  const dbDst = join(macRoot, 'ledger.db');
  if (existsSync(dbSrc)) {
    if (existsSync(dbDst)) {
      cpSync(dbDst, `${dbDst}.bak-${Date.now()}`);
    }
    copySqliteDb(dbSrc, dbDst);
  }

  for (const sub of ['family-events', 'gear-images', 'invoices']) {
    mirrorDir(join(DATA_ROOT, sub), join(macRoot, sub));
  }
  return true;
}

const localBefore = readState();
console.log(`本地当前流水: ${localBefore.transactions.length}`);

const { headers } = await login();

const stateRes = await fetch(`${API_BASE}/api/state`, { headers });
if (!stateRes.ok) throw new Error(`拉取 state 失败: ${await stateRes.text()}`);
const state = await stateRes.json();

writeFileSync(BACKUP_JSON, JSON.stringify(state, null, 2), 'utf-8');
console.log(`已保存 JSON 备份: ${BACKUP_JSON}`);

const stateVersion = writeState(state, { skipVersionCheck: true });
console.log(`已写入账本 SQLite: ${state.transactions?.length ?? 0} 笔，版本 ${stateVersion}`);

const familyRes = await fetch(`${API_BASE}/api/family-events`, { headers });
if (!familyRes.ok) throw new Error(`拉取家庭事件失败: ${await familyRes.text()}`);
const { events: cloudEvents = [] } = await familyRes.json();
const familyStats = await syncFamilyEvents(cloudEvents, headers);
console.log(`家庭事件: 云端 ${familyStats.total} 条 → 新建 ${familyStats.created}，更新 ${familyStats.updated}，删本地多余 ${familyStats.removed}，下载图片 ${familyStats.images}`);

const invoiceRes = await fetch(`${API_BASE}/api/invoices`, { headers });
if (!invoiceRes.ok) throw new Error(`拉取发票失败: ${await invoiceRes.text()}`);
const { invoices: cloudInvoices = [] } = await invoiceRes.json();
const invoiceStats = await syncInvoices(cloudInvoices, headers);
console.log(`公司发票: 云端 ${invoiceStats.total} 条 → 新建 ${invoiceStats.created}，更新 ${invoiceStats.updated}，下载文件 ${invoiceStats.files}，本地共 ${invoiceStats.local} 条`);

const gearStats = await syncGearImages(state.gearLibrary, headers);
console.log(`装备图片: 下载 ${gearStats.downloaded}，已有/跳过 ${gearStats.skipped}`);

if (syncToMacApp()) {
  console.log(`已同步到 Mac 应用库: ~/Library/Application Support/Loc's Home/data/`);
} else {
  console.log('未找到 Mac 应用目录，仅更新项目 data/');
}

console.log('全部拉取完成。');
