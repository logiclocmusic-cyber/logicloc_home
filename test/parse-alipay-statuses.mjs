import assert from 'node:assert/strict';

class TestFileReader {
  readAsArrayBuffer(file) {
    file.arrayBuffer().then(
      result => {
        this.result = result;
        this.onload?.();
      },
      error => {
        this.error = error;
        this.onerror?.();
      }
    );
  }
}

globalThis.FileReader = TestFileReader;

const { Parsers } = await import('../src/parsers.js');

const accepted = [
  '交易成功',
  '转账成功',
  '等待确认收货',
  '等待对方确认收货',
  '收款成功',
  '还款成功',
  '代付成功',
  '名下账户代付付款成功',
  '支付成功',
  '生活缴费成功',
];
const rejected = ['退款成功', '交易关闭', '待付款', '等待付款'];
const header = '交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号';
const records = [...accepted, ...rejected].map((status, index) =>
  `2026-07-${String(index + 1).padStart(2, '0')} 12:00:00,测试,商户${index},商品${index},支出,10.00,银行卡,${status},ORDER${index}`
);
const bytes = new TextEncoder().encode([header, ...records].join('\n'));
const file = {
  name: '支付宝交易明细(20260701-20260731).csv',
  type: 'text/csv',
  arrayBuffer: async () => bytes.buffer,
};

const result = await Parsers.parseFile(file, '支付宝-测试', 'auto', []);

assert.equal(result.records.length, accepted.length);
assert.deepEqual(
  result.records.map(row => row['交易单号']),
  accepted.map((_, index) => `ORDER${index}`)
);

console.log(`支付宝状态解析通过：保留 ${accepted.length} 种有效状态，排除 ${rejected.length} 种无效状态`);
