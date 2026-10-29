# 测试脚本 - 在 Node 中验证解析器
import { readFileSync } from 'fs';
import { createRequire } from 'module';

// 简易 localStorage mock
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
global.STORAGE_KEYS = { rules: 'family_ledger_rules' };

// 加载脚本（简化版内联测试）
const text = readFileSync('test/wechat-sample.csv', 'utf-8');

function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field.trim()); if (row.some(c => c)) rows.push(row);
      row = []; field = ''; if (ch === '\r') i++;
    } else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field.trim()); if (row.some(c => c)) rows.push(row); }
  return rows;
}

const rows = parseCSV(text);
console.log('Rows:', rows.length);
console.log('Header:', rows[0]);
console.log('First record:', rows[1]);
