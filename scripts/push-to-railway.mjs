#!/usr/bin/env node
/** 将本地 SQLite 数据推送到 Railway 生产环境 */
import { readState, db } from '../server/db.js';

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

const nextId = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'nextId'").get()?.value || '1');

const state = { ...readState(), nextId };

console.log(`本地记录数: ${state.transactions.length}`);

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

async function putState(body) {
  return fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

let putRes = await putState(state);
if (putRes.status === 409) {
  const conflict = await putRes.json();
  console.log(`线上版本 ${conflict.currentVersion}，本地 ${state.stateVersion ?? 0}，以本地数据覆盖…`);
  state.stateVersion = conflict.currentVersion;
  putRes = await putState(state);
}
if (!putRes.ok) {
  console.error('上传失败:', await putRes.text());
  process.exit(1);
}

const health = await fetch(`${API_BASE}/api/health`).then(r => r.json());
console.log(`上传成功，线上记录数: ${health.count}`);
