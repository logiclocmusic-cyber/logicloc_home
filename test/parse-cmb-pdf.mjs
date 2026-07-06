#!/usr/bin/env node
/** 本地验证招商银行 PDF 流水解析 */
import { readFileSync } from 'fs';
import { pdfToText } from '../server/pdfText.js';
import { Parsers } from '../src/parsers.js';

const pdfPath = process.argv[2] || '/Users/logiclocmusic/Downloads/招商银行交易流水(申请时间2026年07月06日22时51分26秒).pdf';
const text = await pdfToText(readFileSync(pdfPath));
const rows = text.split('\n').map(line => [line.trim()]).filter(r => r[0]);

const sources = [
  { name: '招行-胡晗', color: '#c41230' },
  { name: '中信-陈橙', color: '#c41230' }
];

const format = Parsers.detectFormat(rows);
const sourceName = Parsers.resolveSourceName({ name: '招商银行交易流水.pdf' }, rows, format, sources);
const records = Parsers.parseCmbBank(rows, sourceName);

console.log('format:', format);
console.log('source:', sourceName);
console.log('records:', records.length);
console.log('sample:', records.slice(0, 3).map(r => ({
  日期: r['日期'], 收支: r['收支'], 金额: r['金额'], 交易对方: r['交易对方'], 商品说明: r['商品说明']
})));
console.log('income:', records.filter(r => r['收支'] === '收入').length);
console.log('expense:', records.filter(r => r['收支'] === '支出').length);
