import { imageToText } from './ocr.js';
import { pdfToText, isInvoiceTextUsable, pdfPageImageForOcr, hasPoppler } from './pdfText.js';
import { geminiEnabled, scanInvoiceWithGemini, scanInvoiceTextWithGemini } from './gemini-invoice.js';

const API_BASE = normalizeApiBase(process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const VISION_BASE = normalizeApiBase(process.env.DEEPSEEK_VISION_API_BASE || '');
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || '';

function normalizeApiBase(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function visionEnabled() {
  return !!(VISION_BASE && VISION_MODEL && (
    process.env.DEEPSEEK_VISION_API_KEY || process.env.DEEPSEEK_API_KEY
  ));
}

/** 文本解析：可用官方 DeepSeek，或复用硅基流动等视觉端点 */
function textAiConfig() {
  const visionKey = String(process.env.DEEPSEEK_VISION_API_KEY || '').trim();
  const deepseekKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (deepseekKey && process.env.DEEPSEEK_API_BASE) {
    return { apiKey: deepseekKey, base: API_BASE, model: MODEL };
  }
  if (visionKey && VISION_BASE && VISION_MODEL) {
    return { apiKey: visionKey, base: VISION_BASE, model: VISION_MODEL };
  }
  if (deepseekKey) {
    return { apiKey: deepseekKey, base: API_BASE, model: MODEL };
  }
  return null;
}

function deepseekOrVisionConfigured() {
  return !!(textAiConfig() || visionEnabled());
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

function normalizeInvoiceNo(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 22 ? digits : raw;
}

function normalizeMoney(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const cleaned = String(value).replace(/[¥￥,\s元]/g, '').trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function normalizeInvoiceFields(parsed = {}, opts = {}) {
  const sourceText = opts.sourceText || '';
  parsed = mapChineseInvoiceFields(parsed);
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
    invoiceNo: normalizeInvoiceNo(parsed.invoiceNo || parsed.invoice_no || ''),
    invoiceDate: normalizeInvoiceDate(parsed.invoiceDate || parsed.invoice_date || ''),
    amount: normalizeMoney(parsed.amount),
    taxAmount: normalizeMoney(parsed.taxAmount ?? parsed.tax_amount),
    total: normalizeMoney(parsed.total),
    category: normalizeInvoiceCategory(parsed.category),
    items: parsed.items || [],
    notes: parsed.notes || ''
  };
}

export function invoiceReviewWarnings(parsed = {}) {
  const invoice = normalizeInvoiceFields(parsed);
  const warnings = [];
  const no = String(invoice.invoiceNo || '');
  if (!/^(?:\d{8}|\d{10}|\d{12}|\d{20})$/.test(no)) {
    warnings.push('发票号码格式异常，请核对原票');
  }
  if (!invoice.invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate)) {
    warnings.push('未可靠识别开票日期');
  }
  if (!invoice.vendor) warnings.push('未可靠识别销售方');
  if (!COMPANY_BUYERS.some(company => company.full === invoice.buyer)) {
    warnings.push('购买方不是已登记的公司，请核对');
  }
  if (
    invoice.amount != null
    && invoice.taxAmount != null
    && invoice.total != null
    && Math.abs(invoice.amount + invoice.taxAmount - invoice.total) > 0.02
  ) {
    warnings.push('不含税金额加税额与价税合计不一致');
  }
  return warnings;
}

function moneyFromText(value) {
  return normalizeMoney(String(value || '').replace(/[^\d.,-]/g, ''));
}

function cleanPartyName(value) {
  return String(value || '')
    .replace(/(?:纳税人识别号|统一社会信用代码|地址、电话|开户行及账号).*$/g, '')
    .replace(/^[：:\s]+|[：:\s]+$/g, '')
    .trim();
}

/** 仅根据 OCR/PDF 原文做确定性提取，不调用 AI，也不猜测缺失字段。 */
export function parseInvoiceOcrText(sourceText = '', fileName = '') {
  const text = String(sourceText || '').replace(/\r/g, '\n');
  const compact = text.replace(/[ \t]+/g, ' ');
  const parsed = {};

  const invoiceNo = invoiceNoFromFilename(fileName)
    || enrichParsedFromOcrText({}, text).invoiceNo;
  if (invoiceNo) parsed.invoiceNo = invoiceNo;

  const dateMatch = compact.match(/开\s*票\s*日\s*期\s*[:：]?\s*(\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2})/)
    || compact.match(/(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/)
    || compact.match(/(?<!\d)(\d{4}-\d{1,2}-\d{1,2})(?!\d)/);
  if (dateMatch) parsed.invoiceDate = normalizeInvoiceDate(dateMatch[1]);

  const buyers = matchCompanyBuyer(compactName(text));
  if (buyers.length === 1) parsed.buyer = buyers[0];

  const nameCandidates = [...compact.matchAll(/名\s*称\s*[:：]\s*([^\n]{2,80})/g)]
    .map(match => cleanPartyName(match[1]))
    .filter(name => name && !/^[\dA-Z]+$/i.test(name));
  parsed.vendor = nameCandidates.find(name =>
    !isCompanyBuyer(name)
    && !/购买方|销售方|发票号码|纳税人/.test(name)
  ) || '';

  const totalMatch = compact.match(/价\s*税\s*合\s*计(?:\s*[（(]小写[）)])?[\s:：¥￥]*(\d[\d,]*\.\d{2})/);
  if (totalMatch) parsed.total = moneyFromText(totalMatch[1]);

  const lines = compact.split('\n').map(line => line.trim()).filter(Boolean);
  const sumLine = lines.find(line => /合\s*计/.test(line) && !/价\s*税\s*合\s*计/.test(line));
  if (sumLine) {
    const values = [...sumLine.matchAll(/(?:¥|￥)?\s*(\d[\d,]*\.\d{2})/g)]
      .map(match => moneyFromText(match[1]))
      .filter(value => value != null);
    if (values.length >= 2) {
      parsed.amount = values[values.length - 2];
      parsed.taxAmount = values[values.length - 1];
    }
  }

  return normalizeInvoiceFields(parsed, { sourceText: text });
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
- 发票号码必须读取“发票号码”字段；禁止把购买方或销售方的纳税人识别号、统一社会信用代码当成发票号码
- invoiceDate: 开票日期，必须返回 YYYY-MM-DD（例如 2025-06-14）
- 不要把打印日期、订单日期、服务期间当成开票日期
- amount: 不含税金额（数字）
- taxAmount: 税额（数字）
- total: 价税合计（数字）
- 金额必须读取发票合计栏：amount + taxAmount 应等于 total；不要使用单价、数量、税率或大写金额
- category: 费用类型，从以下选一个：办公用品、差旅、餐饮、设备、服务、租金、其他
- items: 固定返回空数组 []，不要逐项抄录商品明细
- notes: 备注摘要

请逐字读取，不要猜测或补写发票上不存在的信息。无法识别的字段填 null。金额字段必须是数字或 null。`;

async function chatCompletion(messages, { json = true } = {}) {
  const cfg = textAiConfig();
  if (!cfg) throw new Error('未配置 DEEPSEEK_API_KEY 或硅基流动视觉密钥');

  const body = { model: cfg.model, temperature: 0.1, messages };
  let res = await fetch(`${cfg.base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(json ? { ...body, response_format: { type: 'json_object' } } : body)
  });

  if (!res.ok && json) {
    res = await fetch(`${cfg.base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API 错误 (${res.status}): ${err.slice(0, 300)}`);
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

function mapChineseInvoiceFields(parsed = {}) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    ...p,
    vendor: p.vendor || p.seller || p['销售方'] || p['销方名称'] || p['销方'],
    buyer: p.buyer || p.buyer_name || p['购买方'] || p['购方名称'] || p['购方'],
    invoiceNo: p.invoiceNo || p.invoice_no || p['发票号码'] || p['发票号'],
    invoiceDate: p.invoiceDate || p.invoice_date || p['开票日期'],
    amount: p.amount ?? p['金额'] ?? p['不含税金额'] ?? null,
    taxAmount: p.taxAmount ?? p.tax_amount ?? p['税额'] ?? null,
    total: p.total ?? p['价税合计'] ?? p['合计'] ?? null,
    category: p.category || p['费用类型'] || p['分类'],
    notes: p.notes || p['备注'],
  };
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* try next */ }
    }
  }
  return null;
}

function extractAssistantText(message = {}) {
  const { content, reasoning_content: reasoning } = message;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .filter(part => part?.type === 'text' && part.text)
      .map(part => part.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning;
  return '';
}

export function invoiceNoFromFilename(fileName) {
  const name = String(fileName || '');
  const digital = name.match(/(?<!\d)(\d{20})(?!\d)/);
  if (digital) return digital[1];
  // 旧版发票号码可能为 8/10/12 位；仅在文件名明确包含“发票”时采用，
  // 避免把文件名中的 YYYYMMDD 日期误当成发票号。
  if (/发票/.test(name)) {
    const legacy = name.match(/(?<!\d)(\d{12}|\d{10}|\d{8})(?!\d)/);
    if (legacy) return legacy[1];
  }
  return '';
}

function applyFilenameHints(parsed = {}, fileName = '') {
  const fromName = invoiceNoFromFilename(fileName);
  if (fromName) parsed = { ...parsed, invoiceNo: fromName };
  return parsed;
}

/** 从 OCR 原文补全 AI 漏掉的号码/金额（扫描件常见） */
export function enrichParsedFromOcrText(parsed = {}, ocrText = '') {
  const t = String(ocrText || '');
  const p = { ...parsed };
  if (!p.invoiceNo) {
    const m = t.match(/发票[号码号]*\s*[:：]?\s*(\d{20}|\d{12}|\d{10}|\d{8})(?!\d)/)
      || t.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) p.invoiceNo = m[1] || m[0];
  }
  if (p.total == null) {
    const labeled = t.match(/价\s*税\s*合\s*计(?:\s*[（(]小写[）)])?[\s:：¥￥]*(\d[\d,]*\.\d{2})/);
    if (labeled) p.total = parseFloat(labeled[1].replace(/,/g, ''));
  }
  if (p.total == null && p.amount == null) {
    const amounts = [...t.matchAll(/[¥￥]\s*([\d,]+\.\d{2})/g)]
      .map(x => parseFloat(x[1].replace(/,/g, '')))
      .filter(n => !isNaN(n) && n > 0);
    if (amounts.length) p.total = Math.max(...amounts);
  }
  return p;
}

function mergeParseHints(parsed = {}, { fileName = '', ocrText = '' } = {}) {
  return enrichParsedFromOcrText(applyFilenameHints(parsed, fileName), ocrText);
}

export function invoiceResultUsable(parsed = {}, { fileName = '', ocrText = '' } = {}) {
  const n = normalizeInvoiceFields(mergeParseHints(parsed, { fileName, ocrText }));
  const no = String(n.invoiceNo || '').replace(/\s/g, '');
  // 18 位号码通常是纳税人识别号，不应当作为发票号码通过。
  if (!/^(?:\d{8}|\d{10}|\d{12}|\d{20})$/.test(no)) return false;
  return n.total != null || n.amount != null;
}

async function scanWithVision(base64, mime, { ocrHint = '', fileName = '' } = {}) {
  const apiKey = process.env.DEEPSEEK_VISION_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_VISION_API_KEY');
  const base = VISION_BASE || API_BASE;
  const model = VISION_MODEL || MODEL;
  const dataUrl = `data:${mime};base64,${base64}`;
  const fromName = invoiceNoFromFilename(fileName);
  const nameHint = fromName ? `\n文件名中的发票号码参考：${fromName}` : '';
  const hint = ocrHint
    ? `\n\n附带 OCR 参考（可能有误，请结合图片核对）：\n${ocrHint.slice(0, 2500)}`
    : '';

  const buildPayload = (useJsonFormat) => ({
    model,
    temperature: 0.1,
    enable_thinking: false,
    ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `你是发票识别助手。请从这张发票/收据图片中提取信息，只返回 JSON，不要 markdown 代码块。\n\n${FIELDS_HINT}${nameHint}${hint}`
        },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
      ]
    }]
  });

  let lastText = '';
  for (const useJsonFormat of [false, true]) {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildPayload(useJsonFormat))
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`视觉模型错误 (${res.status}): ${err.slice(0, 300)}`);
    }

    const json = await res.json();
    const text = extractAssistantText(json.choices?.[0]?.message || {});
    lastText = text;
    const parsed = parseJsonFromText(text);
    if (parsed && invoiceResultUsable(parsed, { fileName, ocrText: ocrHint })) {
      return { parsed: mergeParseHints(parsed, { fileName, ocrText: ocrHint }), raw: text, mode: 'vision' };
    }
  }

  throw new Error(`视觉模型未识别到完整发票信息：${lastText.slice(0, 200) || '(空响应)'}`);
}

async function scanWithText(sourceText, mode = 'ocr', fileName = '') {
  const label = mode === 'pdf' ? 'PDF 文字' : 'OCR 文字';
  const fromName = invoiceNoFromFilename(fileName);
  const nameHint = fromName ? `\n文件名中的发票号码参考：${fromName}` : '';
  const prompt = buildInvoiceTextPrompt(label, sourceText, nameHint);
  if (geminiEnabled()) {
    const result = await scanInvoiceTextWithGemini(prompt);
    return { ...result, mode: `gemini+${mode}`, ocrText: sourceText };
  }
  const result = await chatCompletion([{ role: 'user', content: prompt }]);
  return { ...result, mode, ocrText: sourceText };
}

function buildInvoiceVisionPrompt(fileName = '', ocrHint = '') {
  const fromName = invoiceNoFromFilename(fileName);
  const nameHint = fromName ? `\n文件名中的发票号码参考：${fromName}` : '';
  const hint = ocrHint
    ? `\n\n附带 OCR 参考（可能有误，请结合图片核对）：\n${ocrHint.slice(0, 2500)}`
    : '';
  return `你是发票识别助手。请从这张发票/收据图片中提取信息，只返回 JSON，不要 markdown 代码块。\n\n${FIELDS_HINT}${nameHint}${hint}`;
}

function buildInvoiceTextPrompt(label, sourceText, nameHint = '') {
  return `你是发票识别助手。以下是发票/收据的${label}，请提取结构化信息，只返回 JSON，不要 markdown 代码块。

${FIELDS_HINT}${nameHint}

${label}：
${sourceText}`;
}

async function scanWithGeminiMedia(buf, mime, { fileName = '', ocrHint = '' } = {}) {
  const prompt = buildInvoiceVisionPrompt(fileName, ocrHint);
  return scanInvoiceWithGemini(buf, mime, { prompt, fileName });
}

export function getAiStatus() {
  const gemini = geminiEnabled();
  const vision = visionEnabled();
  const textCfg = textAiConfig();
  const configured = gemini || deepseekOrVisionConfigured();
  let mode = 'disabled';
  let provider = null;
  let model = null;
  if (gemini) {
    provider = 'gemini';
    mode = 'gemini';
    model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  } else if (vision) {
    provider = /siliconflow/i.test(VISION_BASE) ? 'siliconflow' : 'vision';
    mode = 'vision';
    model = VISION_MODEL;
  } else if (textCfg) {
    provider = /siliconflow/i.test(textCfg.base) ? 'siliconflow' : 'deepseek';
    mode = 'ocr+text';
    model = textCfg.model;
  }
  return {
    configured,
    provider,
    mode,
    model,
    gemini,
    deepseek: !!textCfg,
    configHint: configured ? null : '未配置发票 AI 密钥，可继续使用手动录入',
    visionModel: vision ? VISION_MODEL : null,
    poppler: hasPoppler(),
  };
}

export async function scanInvoiceOcr(base64, mime = 'image/jpeg', opts = {}) {
  const fileName = opts.fileName || '';
  const buf = Buffer.from(base64, 'base64');
  const isPdf = mime === 'application/pdf' || String(mime || '').includes('pdf');
  let sourceText = '';

  if (isPdf) {
    try {
      sourceText = await pdfToText(buf);
    } catch (err) {
      console.warn('[invoice-ocr] PDF text extraction failed:', err.message);
    }
    if (sourceText.replace(/\s/g, '').length < 20) {
      const pageImg = await pdfPageImageForOcr(buf);
      sourceText = await imageToText(pageImg);
    }
  } else {
    sourceText = await imageToText(buf);
  }

  if (!sourceText || sourceText.replace(/\s/g, '').length < 4) {
    throw new Error('未能识别到文字，请上传更清晰的文件，或使用“手动录入”');
  }

  return {
    parsed: parseInvoiceOcrText(sourceText, fileName),
    raw: sourceText,
    ocrText: sourceText,
    mode: 'ocr',
  };
}

export async function scanInvoiceImage(base64, mime = 'image/jpeg', opts = {}) {
  const gemini = geminiEnabled();
  const deepseek = deepseekOrVisionConfigured();
  if (!gemini && !deepseek) {
    throw new Error(
      '未配置 AI 识别密钥。请在 config.env 设置硅基流动 DEEPSEEK_VISION_*，或 GEMINI_API_KEY / DEEPSEEK_API_KEY'
    );
  }

  const fileName = opts.fileName || '';
  const buf = Buffer.from(base64, 'base64');
  const isPdf = mime === 'application/pdf' || String(mime || '').includes('pdf');

  const finish = (result, ocrText = '') => ({
    ...result,
    parsed: mergeParseHints(result.parsed, { fileName, ocrText: ocrText || result.ocrText || '' }),
  });

  const tryText = async (sourceText, mode) => {
    const result = await scanWithText(sourceText, mode, fileName);
    const hints = { fileName, ocrText: sourceText };
    if (!invoiceResultUsable(result.parsed, hints)) return null;
    return finish(result, sourceText);
  };

  if (isPdf) {
    if (gemini) {
      try {
        const result = await scanWithGeminiMedia(buf, 'application/pdf', { fileName });
        if (invoiceResultUsable(result.parsed, { fileName })) return finish(result);
      } catch (err) {
        console.warn('[invoice-scan] gemini pdf failed:', err.message);
      }
    }

    const pdfText = await pdfToText(buf);
    if (pdfText && isInvoiceTextUsable(pdfText)) {
      const r = await tryText(pdfText, 'pdf');
      if (r) return r;
    }

    console.warn('[invoice-scan] PDF text layer insufficient, fallback OCR render');
    const pageImg = await pdfPageImageForOcr(buf);
    let ocrText = '';
    try { ocrText = await imageToText(pageImg); } catch (err) {
      console.warn('[invoice-scan] OCR failed:', err.message);
    }

    if (ocrText && isInvoiceTextUsable(ocrText)) {
      const r = await tryText(ocrText, 'ocr');
      if (r) return r;
    }

    if (visionEnabled()) {
      try {
        const result = await scanWithVision(
          pageImg.toString('base64'),
          'image/png',
          { ocrHint: ocrText, fileName }
        );
        if (invoiceResultUsable(result.parsed, { fileName, ocrText })) return finish(result, ocrText);
      } catch (err) {
        console.warn('[invoice-scan] vision failed:', err.message);
      }
    }

    if (gemini) {
      try {
        const result = await scanWithGeminiMedia(pageImg, 'image/png', { fileName, ocrHint: ocrText });
        if (invoiceResultUsable(result.parsed, { fileName, ocrText })) return finish(result, ocrText);
      } catch (err) {
        console.warn('[invoice-scan] gemini pdf-render failed:', err.message);
      }
    }

    if (ocrText && ocrText.replace(/\s/g, '').length >= 40) {
      const r = await tryText(ocrText, 'ocr');
      if (r) return r;
    }

    const pop = hasPoppler();
    throw new Error(
      pop
        ? '未能从 PDF 识别完整发票信息。该 PDF 可能是扫描件，请改用「手动录入」上传，或导出为 PNG/JPG 后再试 AI 识别'
        : '未能从 PDF 识别完整发票信息。请在 Railway 配置 RAILPACK_DEPLOY_APT_PACKAGES=poppler-utils 并重新部署，或改用「手动录入」'
    );
  }

  // 图片先做一次 OCR，把可复制的文字作为视觉模型的校对依据。
  // OCR 可能不完整，因此仍以原图识别为主，不直接覆盖视觉结果。
  let ocrText = '';
  try {
    ocrText = await imageToText(buf);
  } catch (err) {
    console.warn('[invoice-scan] image OCR hint failed:', err.message);
  }

  if (gemini) {
    try {
      const result = await scanWithGeminiMedia(buf, mime || 'image/jpeg', { fileName, ocrHint: ocrText });
      if (invoiceResultUsable(result.parsed, { fileName, ocrText })) return finish(result, ocrText);
    } catch (err) {
      console.warn('[invoice-scan] gemini image failed, fallback OCR:', err.message);
    }
  }

  if (visionEnabled()) {
    try {
      const result = await scanWithVision(
        buf.toString('base64'),
        mime || 'image/jpeg',
        { fileName, ocrHint: ocrText }
      );
      if (invoiceResultUsable(result.parsed, { fileName, ocrText })) return finish(result, ocrText);
    } catch (err) {
      console.warn('[invoice-scan] vision failed, fallback OCR:', err.message);
    }
  }

  if (!ocrText || ocrText.replace(/\s/g, '').length < 4) {
    throw new Error('未能从图片识别文字，请上传更清晰的发票照片，或手动填写');
  }

  const r = await tryText(ocrText, 'ocr');
  if (r) return r;
  throw new Error('未能从图片识别完整发票信息，请手动填写');
}
