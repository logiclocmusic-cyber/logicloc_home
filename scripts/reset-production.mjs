#!/usr/bin/env node
/** 清空 Railway 线上全部账目与导入历史 */
const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
if (!loginRes.ok) throw new Error('登录失败');
const { token } = await loginRes.json();

const resetRes = await fetch(`${API_BASE}/api/reset-ledger`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ confirm: 'RESET_ALL_TRANSACTIONS' })
});
if (!resetRes.ok) throw new Error('清空失败: ' + await resetRes.text());

const result = await resetRes.json();
console.log('已清空线上全部账目', result);
