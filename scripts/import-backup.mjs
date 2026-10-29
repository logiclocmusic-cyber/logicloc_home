#!/usr/bin/env node
/** 将 JSON 备份一次性导入 SQLite（用于从 localStorage 版迁移） */
import { readFileSync } from 'fs';
import { writeState } from '../server/db.js';

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/import-backup.mjs <备份.json>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf-8'));
const txs = data.transactions || data.manual || [];

writeState({
  transactions: txs.map(r => ({
    ...r,
    _hash: r._hash || '',
    _manualCat: r._manualCat !== undefined ? r._manualCat : true
  })),
  changed: data.changed || {},
  refunded: (data.refunded || []).map(id => typeof id === 'string' ? parseInt(id, 10) : id),
  categories: data.categories || null,
  sources: data.sources || null,
  rules: data.rules || { peerRules: {}, keywordRules: [] },
  importHistory: data.importHistory || [],
  nextId: data.nextId || (txs.length ? Math.max(...txs.map(r => r.id || 0)) + 1 : 1)
});

console.log(`已导入 ${txs.length} 笔记录到 SQLite`);
