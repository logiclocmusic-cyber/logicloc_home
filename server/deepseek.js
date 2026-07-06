import { imageToText } from './ocr.js';
import { pdfToText, isInvoiceTextUsable, pdfPageImageForOcr } from './pdfText.js';

const API_BASE = normalizeApiBase(process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const VISION_BASE = normalizeApiBase(process.env.DEEPSEEK_VISION_API_BASE || '');
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || '';

function normalizeApiBase(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

const INVOICE_CATEGORIES = ['办公用品', '差旅', '餐饮', '设备', '服务', '租金', '其他'];

/** 本公司成本发票的购买方（购方）仅可能为以下两家 */
export const COMPANY_BUYERS = [
  {
    full: '成都小河帮电子商务有限公司',
    aliases: ['小河帮', '小河帮电子商务', '成都小河帮']
  },
  {
    full: '成都乐极客科技有限公司',
    aliases: ['乐极客', '乐极客科技', '成都乐极客']
  }
];

function compactName(s) {
  return String(s || '').replace(/\s/g, '');
}

function namesMatch(a, b) {
  const x = compactName(a);
  const y = compactName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function matchCompanyBuyer(text) {
  const hits = [];
  for (const company of COMPANY_BUYERS) {
    if (text.includes(company.full)) hits.push(company.full);
    else if (company.aliases.some(alias => text.includes(alias))) hits.push(company.full);
  }
  return [...new Set(hits)];
}

function isCompanyBuyer(name) {
  return COMPANY_BUYERS.some(c => namesMatch(name, c.full) || c.aliases.some(a => String(name).includes(a)));
}

function resolveCompanyBuyer(parsed = {}, sourceText = '') {
  const rawBuyer = String(parsed.buyer || parsed.buyer_name || '').trim();
  const rawVendor = String(parsed.vendor || parsed.seller || '').trim();
  const text = `${sourceText}\n${rawBuyer}\n${rawVendor}`;
  const found = matchCompanyBuyer(text);

  if (found.length === 1) return found[0];

  if (found.length > 1) {
    const fromBuyerField = COMPANY_BUYERS.find(c =>
      namesMatch(rawBuyer, c.full) || c.aliases.some(a => rawBuyer.includes(a))
    );
    if (fromBuyerField) return fromBuyerField.full;
    const notVendor = found.find(name => !namesMatch(name, rawVendor));
    if (notVendor) return notVendor;
    return found[0];
  }

  const fuzzy = COMPANY_BUYERS.find(c =>
    namesMatch(rawBuyer, c.full) || c.aliases.some(a => rawBuyer.includes(a))
  );
  if (fuzzy) return fuzzy.full;

  if (isCompanyBuyer(rawVendor) && rawBuyer && !isCompanyBuyer(rawBuyer)) {
    return COMPANY_BUYERS.find(c => namesMatch(rawVendor, c.full) || c.aliases.some(a => rawVendor.includes(a)))?.full || rawVendor;
  }

  return rawBuyer;
}

function resolveVendor(parsed = {}, sourceText = '', buyer = '') {
  let vendor = String(parsed.vendor || parsed.seller || '').trim();
  const rawBuyer = String(parsed.buyer || '').trim();

  if (isCompanyBuyer(vendor) && rawBuyer && !isCompanyBuyer(rawBuyer)) {
    vendor = rawBuyer;
  } else if (namesMatch(vendor, buyer) && rawBuyer && !isCompanyBuyer(rawBuyer)) {
    vendor = rawBuyer;
  } else if (isCompanyBuyer(vendor)) {
    const lines = String(sourceText || '').split(/\n/).map(s => s.trim()).filter(s => s.length > 3);
    const sellerLine = lines.find(line =>
      !COMPANY_BUYERS.some(c => line.includes(c.full) || c.aliases.some(a => line.includes(a)))
      && !/^(名称|购买方|销售方|购|销|备注|开票人)/.test(line)
      && !/^\d{15,}/.test(line)
      && !/^[¥￥]/.test(line)
    );
    if (sellerLine) vendor = sellerLine;
  }

  if (namesMatch(vendor, buyer)) {
    vendor = rawBuyer && !isCompanyBuyer(rawBuyer) ? rawBuyer : vendor;
  }

  return vendor;
}

export function normalizeInvoiceDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function normalizeInvoiceCategory(value) {
  const s = String(value || '').trim();
  return INVOICE_CATEGORIES.includes(s) ? s : '其他';
}

export function normalizeInvoiceFields(parsed = {}, opts = {}) {
  const sourceText = opts.sourceText || '';
  let vendor = String(parsed.vendor || parsed.seller || '').trim();
  let buyer = String(parsed.buyer || parsed.buyer_name || '').trim();

  // AI 常把销购方填反：销售方是本公司、购买方是外部商户时直接对调
  if (isCompanyBuyer(vendor) && buyer && !isCompanyBuyer(buyer)) {
    [vendor, buyer] = [buyer, vendor];
    parsed = { ...parsed, vendor, buyer };
  }

  buyer = resolveCompanyBuyer(parsed, sourceText);
  vendor = resolveVendor(parsed, sourceText, buyer);

  return {
    vendor,
    buyer,
    invoiceNo: parsed.invoiceNo || parsed.invoice_no || '',
    invoiceDate: normalizeInvoiceDate(parsed.invoiceDate || parsed.invoice_date || ''),
    amount: parsed.amount ?? null,
    taxAmount: parsed.taxAmount ?? parsed.tax_amount ?? null,
    total: parsed.total ?? null,
    category: normalizeInvoiceCategory(parsed.category),
    items: parsed.items || [],
    notes: parsed.notes || ''
  };
}

const BUYER_HINT = `购买方（buyer）规则（非常重要）：
- 本公司成本发票的购买方只能是以下两家之一，必须返回完整公司名称：
  1. 成都小河帮电子商务有限公司
  2. 成都乐极客科技有限公司
- 销售方（vendor）是开票商户（餐厅、超市、服务商等），绝不是上述两家公司
- 若原文同时出现上述公司名与商户名：购买方取上述公司之一，销售方取商户名称
- 不要把销售方和购买方填反`;

const FIELDS_HINT = `字段说明：
- vendor: 销售方/开票方名称（销方，开发票的一方，通常是外部商户）
- buyer: 购买方名称（购方，付款收票的一方，只能是本公司的两家主体之一）
${BUYER_HINT}
- invoiceNo: 发票号码
- invoiceDate: 开票日期，必须返回 YYYY-MM-DD（例如 2025-06-14）
- amount: 不含税金额（数字）
- taxAmount: 税额（数字）
- total: 价税合计（数字）
- category: 费用类型，从以下选一个：办公用品、差旅、餐饮、设备、服务、租金、其他
- items: 明细数组，每项 { name, qty, unitPrice, amount }
- notes: 备注摘要

无法识别的字段填 null。金额字段必须是数字或 null。`;

async function chatCompletion(messages, { json = true } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY，请在 Railway 环境变量中添加');

  const body = { model: MODEL, temperature: 0.1, messages };
  let res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(json ? { ...body, response_format: { type: 'json_object' } } : body)
  });

  if (!res.ok && json) {
    res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API 错误 (${res.status}): ${err.slice(0, 300)}`);
  }

  const jsonRes = await res.json();
  const text = jsonRes.choices?.[0]?.message?.content || '';
  try {
    return { parsed: JSON.parse(text), raw: text };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return { parsed: JSON.parse(match[0]), raw: text };
    throw new Error('AI 返回格式无法解析');
  }
}

function visionEnabled() {
  return !!(VISION_BASE && VISION_MODEL);
}

async function visionInputFromBuffer(buf, mime) {
  const isPdf = mime === 'application/pdf' || String(mime || '').includes('pdf');
  if (!isPdf) {
    return { base64: buf.toString('base64'), mime: mime || 'image/jpeg' };
  }
  const pdfText = await pdfToText(buf);
  if (pdfText && isInvoiceTextUsable(pdfText)) {
    return { text: pdfText };
  }
  const pageImg = await pdfPageImageForOcr(buf);
  return { base64: pageImg.toString('base64'), mime: 'image/png' };
}

function visionResultUsable(parsed = {}) {
  return !!(parsed.invoiceNo || parsed.total || parsed.vendor);
}

async function scanWithVision(base64, mime) {
  const apiKey = process.env.DEEPSEEK_VISION_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_VISION_API_KEY');
  const base = VISION_BASE || API_BASE;
  const model = VISION_MODEL || MODEL;
  const dataUrl = `data:${mime};base64,${base64}`;

  const payload = {
    model,
    temperature: 0.1,
    enable_thinking: false,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `你是发票识别助手。请从这张发票/收据图片中提取信息，只返回 JSON，不要 markdown 代码块。\n\n${FIELDS_HINT}` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }]
  };

  let res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...payload, response_format: { type: 'json_object' } })
  });

  if (!res.ok) {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`视觉模型错误 (${res.status}): ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || '';
  try {
    return { parsed: JSON.parse(text), raw: text, mode: 'vision' };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return { parsed: JSON.parse(match[0]), raw: text, mode: 'vision' };
    throw new Error('视觉模型返回格式无法解析');
  }
}

async function scanWithText(sourceText, mode = 'ocr') {
  const label = mode === 'pdf' ? 'PDF 文字' : 'OCR 文字';
  const prompt = `你是发票识别助手。以下是发票/收据的${label}，请提取结构化信息，只返回 JSON，不要 markdown 代码块。

${FIELDS_HINT}

${label}：
${sourceText}`;
  const result = await chatCompletion([{ role: 'user', content: prompt }]);
  return { ...result, mode, ocrText: sourceText };
}

export function getAiStatus() {
  const configured = !!process.env.DEEPSEEK_API_KEY;
  let mode = 'disabled';
  if (configured) {
    mode = visionEnabled() ? 'vision' : 'ocr+deepseek';
  }
  return {
    configured,
    mode,
    model: visionEnabled() ? VISION_MODEL : MODEL,
    visionModel: visionEnabled() ? VISION_MODEL : null,
  };
}

export async function scanInvoiceImage(base64, mime = 'image/jpeg') {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY，请在 Railway 环境变量中添加');
  }

  const buf = Buffer.from(base64, 'base64');
  const isPdf = mime === 'application/pdf' || String(mime || '').includes('pdf');

  if (visionEnabled()) {
    let visionError = null;
    try {
      const input = await visionInputFromBuffer(buf, mime);
      if (input.text) {
        return scanWithText(input.text, 'pdf');
      }
      const result = await scanWithVision(input.base64, input.mime);
      if (visionResultUsable(result.parsed)) return result;
      console.warn('[invoice-scan] vision returned empty fields, fallback OCR');
    } catch (err) {
      visionError = err;
      console.warn('[invoice-scan] vision failed, fallback OCR:', err.message);
    }

    if (isPdf) {
      console.warn('[invoice-scan] PDF text layer insufficient, fallback OCR render');
      const pageImg = await pdfPageImageForOcr(buf);
      const ocrText = await imageToText(pageImg);
      if (ocrText && isInvoiceTextUsable(ocrText)) {
        return scanWithText(ocrText, 'ocr');
      }
      const hint = visionError
        ? `视觉识别失败：${visionError.message}`
        : '视觉识别未返回有效字段';
      throw new Error(`${hint}。请确认 DEEPSEEK_VISION_MODEL 为 Qwen/Qwen3.5-9B，且 DEEPSEEK_VISION_API_KEY 为硅基流动密钥`);
    }
  } else if (isPdf) {
    const pdfText = await pdfToText(buf);
    if (pdfText && isInvoiceTextUsable(pdfText)) {
      return scanWithText(pdfText, 'pdf');
    }
  }

  if (isPdf) {
    console.warn('[invoice-scan] PDF text layer insufficient, fallback OCR render');
    const pageImg = await pdfPageImageForOcr(buf);
    const ocrText = await imageToText(pageImg);
    if (!ocrText || ocrText.replace(/\s/g, '').length < 4) {
      throw new Error('未能从 PDF 识别文字，请上传发票照片（PNG/JPG）或手动填写');
    }
    if (!isInvoiceTextUsable(ocrText)) {
      throw new Error('该 PDF 为扫描件且 OCR 未能可靠识别，请改为上传发票照片（PNG/JPG）或手动填写');
    }
    return scanWithText(ocrText, 'ocr');
  }

  const ocrText = await imageToText(buf);
  if (!ocrText || ocrText.replace(/\s/g, '').length < 4) {
    throw new Error('未能从图片识别文字，请上传更清晰的发票照片，或手动填写');
  }

  return scanWithText(ocrText);
}
