#!/usr/bin/env node
import { Parsers } from '../src/parsers.js';

function row(fields) {
  return {
    id: fields.id,
    日期: fields.date,
    时间: fields.time || '00:00',
    来源: fields.source,
    交易对方: fields.peer || '',
    商品说明: fields.desc || '',
    收支: fields.type,
    金额: fields.amount,
    支付方式: fields.pay || ''
  };
}

const wallet = row({
  id: 1,
  date: '2026-02-12',
  time: '12:08',
  source: '微信-胡晗',
  peer: '美团',
  desc: '外卖订单',
  type: '支出',
  amount: 32.8,
  pay: '招商银行储蓄卡(2758)'
});

const bank = row({
  date: '2026-02-12',
  time: '00:00',
  source: '招行-胡晗',
  peer: '深圳美团科技有限公司',
  desc: '银联快捷支付',
  type: '支出',
  amount: 32.8
});

const bankImportDecision = Parsers.crossSourceDedupDecision(bank, wallet);
const walletImportDecision = Parsers.crossSourceDedupDecision(wallet, bank);
const matched = Parsers.isBankWalletCrossMatch(bank, wallet);

console.log('bank-wallet match:', matched);
console.log('import bank ->', bankImportDecision);
console.log('import wallet ->', walletImportDecision);

const index = Parsers.buildCrossSourceIndex([wallet]);
const dup = Parsers.findCrossSourceDuplicate(bank, index);
console.log('bank finds wallet dup:', dup?.['来源'] || null);

if (!matched) throw new Error('expected bank-wallet match');
if (bankImportDecision !== 'skip_incoming') throw new Error('bank should be skipped');
if (walletImportDecision !== 'replace_existing') throw new Error('wallet should replace bank');
if (!dup) throw new Error('bank should find wallet duplicate');

console.log('OK');
