#!/usr/bin/env node
/** 将本地缺失的交易合并到 Railway，不覆盖已有数据 */
import { DatabaseSync } from 'node:sqlite';

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';
const SOURCE_FILTER = process.env.MERGE_SOURCE || '';
const YEAR_FILTER = process.env.MERGE_YEAR || '';

function txnDedupKey(row) {
  const t = String(row['时间'] || '00:00').trim().split(':');
  const time = `${(t[0] || '0').padStart(2, '0')}:${(t[1] || '0').padStart(2, '0')}`;
  return [
    row['日期'], time, row['来源'],
    (row['交易对方'] || '').trim(), row['收支'],
    Number(row['金额'] || 0).toFixed(2)
  ].join('|');
}

function rowKey(row) {
  const oid = String(row['交易单号'] || '').trim();
  if (oid) return `oid:${oid}`;
  return txnDedupKey(row);
}

const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
if (!loginRes.ok) throw new Error('登录失败');
const { token } = await loginRes.json();
const authHdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const db = new DatabaseSync('data/ledger.db');
let sql = 'SELECT body FROM transactions';
const conds = [];
if (SOURCE_FILTER) conds.push(`json_extract(body,'$.来源')='${SOURCE_FILTER.replace(/'/g, "''")}'`);
if (YEAR_FILTER) conds.push(`json_extract(body,'$.日期') LIKE '${YEAR_FILTER.replace(/'/g, "''")}-%'`);
if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
const local = db.prepare(sql).all().map(r => JSON.parse(r.body));

// 优先使用服务端合并接口（原子追加，避免被浏览器旧数据覆盖）
const mergeRes = await fetch(`${API_BASE}/api/merge-transactions`, {
  method: 'POST',
  headers: authHdr,
  body: JSON.stringify({ transactions: local })
});

if (mergeRes.ok) {
  const result = await mergeRes.json();
  if (!result.added) {
    console.log('无缺失记录需要合并');
  } else {
    console.log(`已合并 ${result.added} 笔记录到线上（总计 ${result.total} 笔）`);
  }
  process.exit(0);
}

if (mergeRes.status !== 404) {
  throw new Error('合并失败: ' + await mergeRes.text());
}

// 旧版后端回退：全量 PUT
const stateRes = await fetch(`${API_BASE}/api/state`, { headers: authHdr });
if (!stateRes.ok) throw new Error('加载远程数据失败');
const state = await stateRes.json();

const keys = new Set((state.transactions || []).map(rowKey));
const maxId = (state.transactions || []).reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
let nextId = Math.max(Number(state.nextId) || 1, maxId + 1);
const added = [];

for (const r of local) {
  if (keys.has(rowKey(r))) continue;
  const row = { ...r, id: nextId++ };
  keys.add(rowKey(row));
  added.push(row);
}

if (!added.length) {
  console.log('无缺失记录需要合并');
  process.exit(0);
}

state.transactions = [...(state.transactions || []), ...added];
state.transactions.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
state.nextId = nextId;

const putRes = await fetch(`${API_BASE}/api/state`, {
  method: 'PUT',
  headers: authHdr,
  body: JSON.stringify(state)
});
if (!putRes.ok) throw new Error('保存失败: ' + await putRes.text());

console.log(`已合并 ${added.length} 笔记录到线上（总计 ${state.transactions.length} 笔）`);
console.log('⚠️  服务端未部署 merge 接口，请关闭所有记账本网页标签后刷新，避免旧页面覆盖数据');
