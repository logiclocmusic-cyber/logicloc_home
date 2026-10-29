#!/usr/bin/env node
/** 仅拉取云端 state 保存为 JSON，不修改本地数据库 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(__dirname, '..', 'data', `cloud-snapshot-${Date.now()}.json`);

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL;
const PASSWORD = process.env.RAILWAY_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('请设置环境变量 RAILWAY_EMAIL 和 RAILWAY_PASSWORD');
  process.exit(1);
}

const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
if (!loginRes.ok) {
  console.error('登录失败:', await loginRes.text());
  process.exit(1);
}
const { token } = await loginRes.json();

const [health, stateRes] = await Promise.all([
  fetch(`${API_BASE}/api/health`).then(r => r.json()),
  fetch(`${API_BASE}/api/state`, { headers: { Authorization: `Bearer ${token}` } })
]);
if (!stateRes.ok) {
  console.error('拉取失败:', await stateRes.text());
  process.exit(1);
}
const state = await stateRes.json();
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), health, state }, null, 2), 'utf-8');

console.log('saved:', OUT);
console.log('health:', health);
console.log('stateVersion:', state.stateVersion);
console.log('transactions:', state.transactions?.length ?? 0);
console.log('categories:', state.categories?.length ?? 0);
console.log('rules keywords:', state.rules?.keywordRules?.length ?? 0);
