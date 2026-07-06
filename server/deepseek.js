import { imageToText } from './ocr.js';
import { pdfToText, isInvoiceTextUsable, pdfPageImageForOcr, hasPoppler } from './pdfText.js';

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

function invoiceNoFromFilename(fileName) {
  const m = String(fileName || '').match(/(\d{18,22})/);
  return m ? m[1] : '';
}

function applyFilenameHints(parsed = {}, fileName = '') {
  if (!parsed.invoiceNo) {
    const fromName = invoiceNoFromFilename(fileName);
    if (fromName) parsed = { ...parsed, invoiceNo: fromName };
  }
  return parsed;
}

/** 从 OCR 原文补全 AI 漏掉的号码/金额（扫描件常见） */
function enrichParsedFromOcrText(parsed = {}, ocrText = '') {
  const t = String(ocrText || '');
  const p = { ...parsed };
  if (!p.invoiceNo) {
    const m = t.match(/发票[号码号]*\s*[:：]?\s*(\d{18,22})/)
      || t.match(/\b(\d{20})\b/)
      || t.match(/(\d{18,22})/);
    if (m) p.invoiceNo = m[1] || m[0];
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

function invoiceResultUsable(parsed = {}, { fileName = '', ocrText = '' } = {}) {
  const n = normalizeInvoiceFields(mergeParseHints(parsed, { fileName, ocrText }));
  const no = String(n.invoiceNo || '').replace(/\s/g, '');
  if (!/^\d{18,22}$/.test(no)) return false;
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
  const prompt = `你是发票识别助手。以下是发票/收据的${label}，请提取结构化信息，只返回 JSON，不要 markdown 代码块。

${FIELDS_HINT}${nameHint}

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
    poppler: hasPoppler(),
  };
}

export async function scanInvoiceImage(base64, mime = 'image/jpeg', opts = {}) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY，请在 Railway 环境变量中添加');
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

  if (visionEnabled()) {
    try {
      const result = await scanWithVision(buf.toString('base64'), mime || 'image/jpeg', { fileName });
      if (invoiceResultUsable(result.parsed, { fileName })) return finish(result);
    } catch (err) {
      console.warn('[invoice-scan] vision failed, fallback OCR:', err.message);
    }
  }

  const ocrText = await imageToText(buf);
  if (!ocrText || ocrText.replace(/\s/g, '').length < 4) {
    throw new Error('未能从图片识别文字，请上传更清晰的发票照片，或手动填写');
  }

  const r = await tryText(ocrText, 'ocr');
  if (r) return r;
  throw new Error('未能从图片识别完整发票信息，请手动填写');
}
