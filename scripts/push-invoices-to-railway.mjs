#!/usr/bin/env node
/** 将本地公司成本发票（含附件）推送到 Railway 生产环境 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { listInvoices, INVOICE_DIR, normalizeInvoiceNo } from '../server/invoices.js';

const API_BASE = (process.env.RAILWAY_API_BASE || 'https://logiclochome-production.up.railway.app').replace(/\/+$/, '');
const EMAIL = process.env.RAILWAY_EMAIL || 'logicloc@qq.com';
const PASSWORD = process.env.RAILWAY_PASSWORD || 'huhan123';

const localInvoices = listInvoices();
console.log(`本地发票数: ${localInvoices.length}`);

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
const headers = { Authorization: `Bearer ${token}` };

const cloudRes = await fetch(`${API_BASE}/api/invoices`, { headers });
if (!cloudRes.ok) {
  console.error('拉取云端发票失败:', await cloudRes.text());
  process.exit(1);
}
const { invoices: cloudInvoices = [] } = await cloudRes.json();
const cloudNos = new Set(cloudInvoices.map(inv => normalizeInvoiceNo(inv.invoiceNo)).filter(Boolean));
console.log(`云端发票数: ${cloudInvoices.length}`);

let uploaded = 0;
let skipped = 0;
let failed = 0;

for (const inv of localInvoices) {
  const key = normalizeInvoiceNo(inv.invoiceNo);
  if (key && cloudNos.has(key)) {
    console.log(`跳过（已存在）: ${inv.invoiceNo}`);
    skipped++;
    continue;
  }

  const filePath = inv.fileUrl ? join(INVOICE_DIR, inv.fileUrl.replace('/invoice-files/', '')) : null;
  let data;
  if (filePath) {
    try {
      const buf = readFileSync(filePath);
      const mime = inv.mimeType || 'application/octet-stream';
      data = `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      console.error(`读取文件失败 ${inv.invoiceNo}:`, err.message);
      failed++;
      continue;
    }
  }

  const payload = {
    vendor: inv.vendor,
    buyer: inv.buyer,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    amount: inv.amount,
    taxAmount: inv.taxAmount,
    total: inv.total,
    category: inv.category,
    items: inv.items,
    notes: inv.notes,
    status: inv.status,
    printed: inv.printed,
    fileName: inv.fileName,
    mime: inv.mimeType,
    data
  };

  const res = await fetch(`${API_BASE}/api/invoices`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.status === 409) {
    console.log(`跳过（云端重复）: ${inv.invoiceNo}`);
    skipped++;
    if (key) cloudNos.add(key);
    continue;
  }
  if (!res.ok) {
    console.error(`上传失败 ${inv.invoiceNo}:`, await res.text());
    failed++;
    continue;
  }

  const created = await res.json();
  if (key) cloudNos.add(key);
  console.log(`已上传: ${inv.invoiceNo} → 云端 id ${created.id}`);
  uploaded++;
}

console.log(`完成：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}`);
