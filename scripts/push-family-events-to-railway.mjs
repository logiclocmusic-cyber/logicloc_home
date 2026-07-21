#!/usr/bin/env node
/** 将本地 Mac 应用中的家庭事件（含图片）推送到 Railway 生产环境 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const APP_DATA = process.env.LOCAL_APP_DATA
  || join(homedir(), "Library/Application Support/Loc's Home/data");

process.env.DB_PATH = process.env.DB_PATH || join(APP_DATA, 'ledger.db');
process.env.FAMILY_EVENT_DIR = process.env.FAMILY_EVENT_DIR || join(APP_DATA, 'family-events');

const { listFamilyEvents, FAMILY_EVENT_DIR } = await import('../server/family-events.js');

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

function eventKey(ev) {
  return `${String(ev.eventDate || '').trim()}|${String(ev.title || '').trim()}`;
}

function guessMime(fileName = '') {
  const ext = String(fileName).split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

const localEvents = listFamilyEvents();
console.log(`本地家庭事件: ${localEvents.length} 条`);
console.log(`数据源: ${process.env.DB_PATH}`);
console.log(`图片目录: ${FAMILY_EVENT_DIR}`);

if (!localEvents.length) {
  console.log('没有需要同步的数据。');
  process.exit(0);
}

const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) {
  console.error('登录失败:', await loginRes.text());
  process.exit(1);
}
const { token } = await loginRes.json();
const headers = { Authorization: `Bearer ${token}` };

const cloudRes = await fetch(`${API_BASE}/api/family-events`, { headers });
if (!cloudRes.ok) {
  console.error('拉取云端家庭事件失败:', await cloudRes.text());
  process.exit(1);
}
const { events: cloudEvents = [] } = await cloudRes.json();
const cloudByKey = new Map(cloudEvents.map(ev => [eventKey(ev), ev]));
console.log(`云端家庭事件: ${cloudEvents.length} 条`);

let created = 0;
let skipped = 0;
let imagesUploaded = 0;
let failed = 0;

for (const ev of localEvents) {
  const key = eventKey(ev);
  let cloudEv = cloudByKey.get(key);

  if (cloudEv) {
    console.log(`跳过（已存在）: ${ev.title} · ${ev.eventDate}`);
    skipped++;
  } else {
    const res = await fetch(`${API_BASE}/api/family-events`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ev.title,
        eventDate: ev.eventDate,
        notes: ev.notes,
      }),
    });
    if (!res.ok) {
      console.error(`创建失败 ${ev.title}:`, await res.text());
      failed++;
      continue;
    }
    cloudEv = await res.json();
    cloudByKey.set(eventKey(cloudEv), cloudEv);
    console.log(`已创建: ${ev.title} · ${ev.eventDate} → 云端 id ${cloudEv.id}`);
    created++;
  }

  const cloudImageNames = new Set((cloudEv.images || []).map(img => img.name));
  for (const img of ev.images || []) {
    if (cloudImageNames.has(img.name)) {
      console.log(`  图片已存在: ${img.name}`);
      continue;
    }
    const filePath = join(FAMILY_EVENT_DIR, img.name);
    if (!existsSync(filePath)) {
      console.error(`  图片文件缺失: ${filePath}`);
      failed++;
      continue;
    }
    const buf = readFileSync(filePath);
    const mime = guessMime(img.name);
    const data = `data:${mime};base64,${buf.toString('base64')}`;
    const uploadRes = await fetch(`${API_BASE}/api/family-events/${cloudEv.id}/images`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, mime, fileName: img.name }),
    });
    if (!uploadRes.ok) {
      console.error(`  图片上传失败 ${img.name}:`, await uploadRes.text());
      failed++;
      continue;
    }
    cloudEv = await uploadRes.json();
    cloudByKey.set(eventKey(cloudEv), cloudEv);
    console.log(`  已上传图片: ${img.name}`);
    imagesUploaded++;
  }
}

const verifyRes = await fetch(`${API_BASE}/api/family-events`, { headers });
const verify = verifyRes.ok ? await verifyRes.json() : { events: [] };
console.log(`完成：新建 ${created}，跳过 ${skipped}，上传图片 ${imagesUploaded}，失败 ${failed}`);
console.log(`云端现有家庭事件: ${verify.events?.length ?? '?'} 条`);
