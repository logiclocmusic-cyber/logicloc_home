import assert from 'node:assert/strict';
import {
  enrichParsedFromOcrText,
  invoiceNoFromFilename,
  invoiceResultUsable,
  invoiceReviewWarnings,
  normalizeInvoiceFields,
  parseInvoiceOcrText,
} from '../server/deepseek.js';

const digitalNo = '25112000000012345678';

assert.equal(
  enrichParsedFromOcrText({}, `购买方纳税人识别号：91510100MA12345678\n发票号码：${digitalNo}`).invoiceNo,
  digitalNo,
  '应读取有标签的发票号码，而不是 18 位纳税人识别号'
);
assert.equal(
  enrichParsedFromOcrText({}, '购买方纳税人识别号：91510100MA12345678').invoiceNo,
  undefined,
  '不得把 18 位纳税人识别号当作发票号码'
);
assert.equal(invoiceNoFromFilename(`电子发票_${digitalNo}.pdf`), digitalNo);
assert.equal(invoiceNoFromFilename('增值税发票_499098217624.pdf'), '499098217624');
assert.equal(invoiceNoFromFilename('20260726_餐饮.pdf'), '', '普通日期不得被当作旧版发票号码');

assert.equal(invoiceResultUsable({ invoiceNo: digitalNo, total: 100 }), true);
assert.equal(invoiceResultUsable({ invoiceNo: '91510100MA12345678', total: 100 }), false);
assert.equal(invoiceResultUsable({ invoiceNo: '499098217624', total: 100 }), true);

const normalized = normalizeInvoiceFields({
  invoiceNo: digitalNo,
  amount: '￥1,000.00',
  taxAmount: '60.00元',
  total: '1,060.00',
});
assert.deepEqual(
  { amount: normalized.amount, taxAmount: normalized.taxAmount, total: normalized.total },
  { amount: 1000, taxAmount: 60, total: 1060 }
);

assert.ok(
  invoiceReviewWarnings({
    invoiceNo: digitalNo,
    invoiceDate: '2026-07-26',
    vendor: '测试销售方',
    buyer: '成都乐极客科技有限公司',
    amount: 100,
    taxAmount: 6,
    total: 120,
  }).some(message => message.includes('不一致')),
  '金额勾稽不一致时应提示人工核对'
);

const ocrParsed = parseInvoiceOcrText(`
电子发票（增值税专用发票）
发票号码：${digitalNo}
开票日期：2026年7月26日
购买方名称：成都乐极客科技有限公司
销售方名称：成都测试服务有限公司
合计 ￥100.00 ￥6.00
价税合计（小写） ￥106.00
`);
assert.equal(ocrParsed.invoiceNo, digitalNo);
assert.equal(ocrParsed.invoiceDate, '2026-07-26');
assert.equal(ocrParsed.buyer, '成都乐极客科技有限公司');
assert.equal(ocrParsed.vendor, '成都测试服务有限公司');
assert.equal(ocrParsed.amount, 100);
assert.equal(ocrParsed.taxAmount, 6);
assert.equal(ocrParsed.total, 106);

console.log('invoice recognition tests passed');
