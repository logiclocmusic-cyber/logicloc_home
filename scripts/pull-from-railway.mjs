#!/usr/bin/env node
/** 从 Railway 生产环境拉取数据写入本地 SQLite */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readState, writeState } from '../server/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUP_JSON = process.env.PULL_BACKUP_JSON || join(ROOT, 'data', 'last-cloud-pull.json');

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

const localBefore = readState();
console.log(`本地当前记录数: ${localBefore.transactions.length}`);

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

const stateRes = await fetch(`${API_BASE}/api/state`, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!stateRes.ok) {
  console.error('拉取失败:', await stateRes.text());
  process.exit(1);
}
const state = await stateRes.json();

writeFileSync(BACKUP_JSON, JSON.stringify(state, null, 2), 'utf-8');
console.log(`已保存 JSON 备份: ${BACKUP_JSON}`);

const stateVersion = writeState(state, { skipVersionCheck: true });
console.log(`已写入本地 SQLite，记录数: ${state.transactions?.length ?? 0}，版本: ${stateVersion}`);
