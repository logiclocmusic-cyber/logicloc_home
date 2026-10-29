import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { deriveImportHistory } from '../src/import-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'ledger.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const META_KEYS = ['refunded', 'excluded', 'categories', 'sources', 'rules', 'importHistory', 'nextId', 'gearLibrary', 'nextGearId', 'gearSections', 'hiddenGearSectionIds', 'renqingAvatars', 'accountCardFaces', 'accountLogos', 'accountRegistry', 'txnPairs', 'txnMerges', 'dayNotes', 'homeCostGroups', 'eventTags', 'eventTagGroups', 'stateVersion'];

function txnRowKey(row) {
  const oid = String(row['交易单号'] || '').trim();
  if (oid) return `oid:${oid}`;
  const t = String(row['时间'] || '00:00').trim().split(':');
  const time = `${(t[0] || '0').padStart(2, '0')}:${(t[1] || '0').padStart(2, '0')}`;
  return [
    row['日期'], time, row['来源'],
    (row['交易对方'] || '').trim(), row['收支'],
    Number(row['金额'] || 0).toFixed(2)
  ].join('|');
}

export function readState() {
  const transactions = db.prepare('SELECT body FROM transactions ORDER BY id').all()
    .map(r => JSON.parse(r.body));

  const metaRows = db.prepare('SELECT key, value FROM meta').all();
  const meta = {};
  for (const row of metaRows) meta[row.key] = JSON.parse(row.value);

  return {
    transactions,
    refunded: meta.refunded || [],
    excluded: meta.excluded || [],
    categories: meta.categories || null,
    sources: meta.sources || null,
    rules: meta.rules || { peerRules: {}, keywordRules: [] },
    importHistory: meta.importHistory || [],
    nextId: meta.nextId || 1,
    gearLibrary: meta.gearLibrary || [],
    nextGearId: meta.nextGearId || 1,
    gearSections: meta.gearSections || [],
    hiddenGearSectionIds: meta.hiddenGearSectionIds || [],
    renqingAvatars: meta.renqingAvatars || {},
    accountCardFaces: meta.accountCardFaces || {},
    accountLogos: meta.accountLogos || {},
    accountRegistry: meta.accountRegistry || { overrides: {}, hidden: [], manual: [], merges: {}, creditHidden: [], creditPools: [], creditGroups: {} },
    txnPairs: meta.txnPairs || [],
    txnMerges: meta.txnMerges || [],
    dayNotes: meta.dayNotes || {},
    homeCostGroups: meta.homeCostGroups || null,
    eventTags: Array.isArray(meta.eventTags) ? meta.eventTags : [],
    eventTagGroups: Array.isArray(meta.eventTagGroups) ? meta.eventTagGroups : [],
    stateVersion: meta.stateVersion || 0
  };
}


function mergeAccountRegistryReminders(existing, incoming) {
  if (!incoming || typeof incoming !== 'object') return existing || { overrides: {}, hidden: [], manual: [], merges: {}, creditHidden: [] };
  const out = { ...incoming };
  const exRem = Array.isArray(existing?.longReminders) ? existing.longReminders : [];
  const inRem = Array.isArray(incoming?.longReminders) ? incoming.longReminders : [];
  const tomb = new Set([
    ...(Array.isArray(existing?.longReminderTombstones) ? existing.longReminderTombstones : []),
    ...(Array.isArray(incoming?.longReminderTombstones) ? incoming.longReminderTombstones : [])
  ]);
  const map = new Map();
  for (const item of exRem) {
    if (!item?.id || tomb.has(item.id)) continue;
    map.set(item.id, item);
  }
  for (const item of inRem) {
    if (!item?.id) continue;
    if (tomb.has(item.id)) { map.delete(item.id); continue; }
    map.set(item.id, item);
  }
  out.longReminders = [...map.values()];
  if (tomb.size) out.longReminderTombstones = [...tomb];
  return out;
}

export function writeState(state, opts = {}) {
  const { expectedVersion, skipVersionCheck } = opts;
  const verRow = db.prepare("SELECT value FROM meta WHERE key = 'stateVersion'").get();
  const curVer = verRow ? JSON.parse(verRow.value) : 0;
  if (!skipVersionCheck && expectedVersion !== undefined && expectedVersion !== curVer) {
    const err = new Error('数据已被其他设备更新');
    err.code = 'STATE_CONFLICT';
    err.currentVersion = curVer;
    throw err;
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions').run();
    const insert = db.prepare('INSERT OR REPLACE INTO transactions (id, body) VALUES (?, ?)');
    for (const t of state.transactions || []) {
      insert.run(t.id, JSON.stringify(t));
    }

    const upsert = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const readMetaJson = (key, fallback) => {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      if (!row) return fallback;
      try { return JSON.parse(row.value); } catch { return fallback; }
    };
    const values = {
      refunded: state.refunded || [],
      excluded: state.excluded || [],
      categories: state.categories || null,
      sources: state.sources || null,
      rules: state.rules || { peerRules: {}, keywordRules: [] },
      importHistory: state.importHistory || [],
      nextId: resolveNextId(state.transactions || [], state.nextId),
      gearLibrary: state.gearLibrary || [],
      nextGearId: state.nextGearId || 1,
      gearSections: state.gearSections || [],
      hiddenGearSectionIds: state.hiddenGearSectionIds || [],
      renqingAvatars: state.renqingAvatars || {},
      accountCardFaces: state.accountCardFaces || {},
      accountLogos: state.accountLogos || {},
      accountRegistry: (() => {
        const row = db.prepare("SELECT value FROM meta WHERE key = ?").get('accountRegistry');
        let existing = {};
        if (row) { try { existing = JSON.parse(row.value); } catch { existing = {}; } }
        return mergeAccountRegistryReminders(existing, state.accountRegistry || {});
      })(),
      txnPairs: state.txnPairs || [],
      txnMerges: state.txnMerges || [],
      dayNotes: state.dayNotes || {},
      homeCostGroups: state.homeCostGroups || null,
      eventTags: Array.isArray(state.eventTags) ? state.eventTags : readMetaJson('eventTags', []),
      eventTagGroups: (() => {
        const incoming = Array.isArray(state.eventTagGroups) ? state.eventTagGroups : null;
        const existing = readMetaJson('eventTagGroups', []);
        if (!incoming) return existing;
        if (opts.keepGroupsWhenEmpty && incoming.length === 0 && existing.length) return existing;
        return incoming;
      })(),
      stateVersion: curVer + 1
    };
    for (const key of META_KEYS) {
      upsert.run(key, JSON.stringify(values[key]));
    }
    db.exec('COMMIT');
    return curVer + 1;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function resolveNextId(transactions, metaNextId) {
  const maxId = transactions.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
  return Math.max(Number(metaNextId) || 1, maxId + 1);
}

/** 合并追加交易（脚本/恢复用），不覆盖已有账目 */
export function mergeTransactions(newRows) {
  const state = readState();
  const keys = new Set(state.transactions.map(txnRowKey));
  let nextId = resolveNextId(state.transactions, state.nextId);
  const added = [];

  for (const r of newRows) {
    if (keys.has(txnRowKey(r))) continue;
    const row = { ...r, id: nextId++ };
    keys.add(txnRowKey(row));
    added.push(row);
  }

  if (!added.length) {
    return { added: 0, total: state.transactions.length, stateVersion: state.stateVersion };
  }

  state.transactions = [...state.transactions, ...added];
  state.transactions.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  state.nextId = nextId;
  const stateVersion = writeState(state, { skipVersionCheck: true });
  return { added: added.length, total: state.transactions.length, stateVersion };
}

/** 修改导入批次关联账目的来源（服务端原子操作） */
export function changeImportBatchSource(batchId, newSource) {
  const state = readState();
  const bid = String(batchId);
  const source = String(newSource || '').trim();
  if (!source) throw new Error('请选择新来源');

  let changed = 0;
  for (const r of state.transactions) {
    if (String(r._importBatchId) === bid) {
      r['来源'] = source;
      changed++;
    }
  }
  if (!changed) throw new Error('未找到该批次的账目');

  state.importHistory = deriveImportHistory(state.transactions, state.importHistory || []);
  const stateVersion = writeState(state, { skipVersionCheck: true });
  return { changed, source, stateVersion };
}

/** 按导入批次 ID 删除关联账目（服务端原子操作，不依赖客户端 stateVersion） */
export function deleteImportBatchById(batchId) {
  const state = readState();
  const bid = String(batchId);
  const toDelete = state.transactions.filter(r => String(r._importBatchId) === bid);
  const deleteIds = new Set(toDelete.map(r => r.id));

  state.transactions = state.transactions.filter(r => !deleteIds.has(r.id));
  state.refunded = (state.refunded || []).filter(id => !deleteIds.has(id));
  state.excluded = (state.excluded || []).filter(id => !deleteIds.has(id));
  state.importHistory = deriveImportHistory(state.transactions, state.importHistory || []);

  const stateVersion = writeState(state, { skipVersionCheck: true });
  return { deleted: toDelete.length, stateVersion };
}

/** 清空全部账目与导入历史，保留分类/来源/规则/装备库等配置 */
export function resetLedger() {
  const verRow = db.prepare("SELECT value FROM meta WHERE key = 'stateVersion'").get();
  const curVer = verRow ? JSON.parse(verRow.value) : 0;
  const newVer = curVer + 1;

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions').run();
    const upsert = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    upsert.run('refunded', JSON.stringify([]));
    upsert.run('excluded', JSON.stringify([]));
    upsert.run('importHistory', JSON.stringify([]));
    upsert.run('nextId', JSON.stringify(1));
    upsert.run('stateVersion', JSON.stringify(newVer));
    db.exec('COMMIT');
    return { ok: true, stateVersion: newVer };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getStats() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  return { count, dbPath: DB_PATH };
}

export function readMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function writeMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
  return value;
}

export { db, DB_PATH };
