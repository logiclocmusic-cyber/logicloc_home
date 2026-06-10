import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

const META_KEYS = ['refunded', 'excluded', 'categories', 'sources', 'rules', 'importHistory', 'nextId', 'gearLibrary', 'nextGearId'];

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
    gearLibrary: meta.gearLibrary || [],
    nextGearId: meta.nextGearId || 1
  };
}

export function writeState(state) {
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
    const values = {
      refunded: state.refunded || [],
      excluded: state.excluded || [],
      categories: state.categories || null,
      sources: state.sources || null,
      rules: state.rules || { peerRules: {}, keywordRules: [] },
      importHistory: state.importHistory || [],
      nextId: state.nextId || 1,
      gearLibrary: state.gearLibrary || [],
      nextGearId: state.nextGearId || 1
    };
    for (const key of META_KEYS) {
      upsert.run(key, JSON.stringify(values[key]));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getStats() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  return { count, dbPath: DB_PATH };
}

export { db, DB_PATH };
