#!/usr/bin/env node
/** 打包前将本地账本复制为 Mac 应用首次安装时的种子数据 */
import { mkdirSync, existsSync, statSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const productName = pkg.productName || pkg.name || "Loc's Home";

const outDir = join(root, 'electron', 'seed');
const dst = join(outDir, 'ledger.db');

const DB_CANDIDATES = [
  join(root, 'data', 'ledger.db'),
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', productName, 'data', 'ledger.db')
    : null
].filter(Boolean);

function checkpointDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function exportDb(srcPath, dstPath) {
  if (existsSync(dstPath)) rmSync(dstPath);
  try {
    checkpointDb(srcPath);
  } catch (err) {
    console.warn(`警告: WAL 合并失败（${srcPath}）：${err.message}`);
  }
  const src = new DatabaseSync(srcPath, { readOnly: true });
  try {
    const escaped = dstPath.replace(/'/g, "''");
    src.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    src.close();
  }
}

function readDbSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const txnCount = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    const metaRow = key => {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : null;
    };
    const accountRegistry = metaRow('accountRegistry') || {};
    return {
      path: dbPath,
      mtime: statSync(dbPath).mtimeMs,
      txnCount,
      accountRegistry,
      accountCardFaces: metaRow('accountCardFaces') || {},
      accountLogos: metaRow('accountLogos') || {},
      accountScore: accountRegistryScore(accountRegistry)
    };
  } finally {
    db.close();
  }
}

function accountRegistryScore(reg) {
  if (!reg || typeof reg !== 'object') return 0;
  const manual = Array.isArray(reg.manual) ? reg.manual.length : 0;
  const overrides = reg.overrides && typeof reg.overrides === 'object' ? Object.keys(reg.overrides).length : 0;
  const cash = Array.isArray(reg.cashAccounts) ? reg.cashAccounts.length : 0;
  const pools = Array.isArray(reg.creditPools) ? reg.creditPools.length : 0;
  return manual * 1000 + overrides * 10 + cash + pools;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function mergeManual(a = [], b = []) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    if (!item?.id) continue;
    map.set(item.id, { ...map.get(item.id), ...item });
  }
  return [...map.values()];
}

function mergeById(a = [], b = [], idKey = 'id') {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const id = item?.[idKey];
    if (!id) continue;
    map.set(id, { ...map.get(id), ...item });
  }
  return [...map.values()];
}

function mergeAccountRegistry(a = {}, b = {}) {
  return {
    overrides: { ...a.overrides, ...b.overrides },
    hidden: uniq([...(a.hidden || []), ...(b.hidden || [])]),
    manual: mergeManual(a.manual, b.manual),
    merges: { ...a.merges, ...b.merges },
    creditHidden: uniq([...(a.creditHidden || []), ...(b.creditHidden || [])]),
    creditPools: mergeById(a.creditPools, b.creditPools),
    creditGroups: { ...a.creditGroups, ...b.creditGroups },
    cashAccounts: mergeById(a.cashAccounts, b.cashAccounts),
    expenseBudgets: mergeById(a.expenseBudgets, b.expenseBudgets),
    lifeAccounts: mergeById(a.lifeAccounts, b.lifeAccounts),
    longReminders: mergeById(a.longReminders, b.longReminders),
    webAccounts: mergeWebAccounts(a.webAccounts, b.webAccounts)
  };
}

function mergeWebAccounts(a, b) {
  const cols = mergeById(a?.columns, b?.columns);
  const colIds = new Set(cols.map(c => c.id));
  const rows = mergeById(a?.rows, b?.rows).map(row => {
    const cells = { ...(row.cells || {}) };
    for (const id of Object.keys(cells)) {
      if (!colIds.has(id)) delete cells[id];
    }
    return { ...row, cells };
  });
  return { columns: cols, rows };
}

function pickPrimaryDb(snapshots) {
  return [...snapshots].sort((a, b) => (
    b.txnCount - a.txnCount
    || b.accountScore - a.accountScore
    || b.mtime - a.mtime
  ))[0];
}

function mergeAccountMeta(snapshots) {
  return snapshots.reduce((acc, snap) => ({
    accountRegistry: mergeAccountRegistry(acc.accountRegistry, snap.accountRegistry),
    accountCardFaces: { ...acc.accountCardFaces, ...snap.accountCardFaces },
    accountLogos: { ...acc.accountLogos, ...snap.accountLogos }
  }), {
    accountRegistry: {},
    accountCardFaces: {},
    accountLogos: {}
  });
}

function writeAccountMeta(dbPath, meta) {
  const db = new DatabaseSync(dbPath);
  try {
    const upsert = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    upsert.run('accountRegistry', JSON.stringify(meta.accountRegistry));
    upsert.run('accountCardFaces', JSON.stringify(meta.accountCardFaces));
    upsert.run('accountLogos', JSON.stringify(meta.accountLogos));
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

const snapshots = DB_CANDIDATES.filter(existsSync).map(readDbSnapshot);
if (!snapshots.length) {
  console.log('未找到本地账本，跳过种子数据（首次打开将创建空账本）');
  process.exit(0);
}

const primary = pickPrimaryDb(snapshots);
const accountMeta = mergeAccountMeta(snapshots);

mkdirSync(outDir, { recursive: true });
exportDb(primary.path, dst);
writeAccountMeta(dst, accountMeta);

const manual = accountMeta.accountRegistry.manual?.length || 0;
const overrides = Object.keys(accountMeta.accountRegistry.overrides || {}).length;
const sources = snapshots.map(s => `${s.path} (${s.txnCount} 笔, 账户分 ${s.accountScore})`).join('\n  ');

console.log(`已生成种子数据库 → ${dst}`);
console.log(`  主库: ${primary.path}`);
console.log(`  合并来源:\n  ${sources}`);
console.log(`  账户信息: 手动 ${manual} 条, 覆盖 ${overrides} 条`);
