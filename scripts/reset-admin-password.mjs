#!/usr/bin/env node
/** 重置本地 SQLite 管理账户密码（默认 logicloc@qq.com） */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from '../server/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'ledger.db');
const EMAIL = (process.env.ADMIN_EMAIL || 'logicloc@qq.com').trim().toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || 'huhan123';

const db = new DatabaseSync(DB_PATH);
const user = db.prepare('SELECT id, email, username FROM users WHERE email = ?').get(EMAIL);
if (!user) {
  console.error(`未找到用户：${EMAIL}`);
  console.error('可用账户：', db.prepare('SELECT email, username FROM users').all());
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(PASSWORD), user.id);
console.log(`已重置密码：${user.username} <${user.email}>`);
console.log(`新密码：${PASSWORD}`);
