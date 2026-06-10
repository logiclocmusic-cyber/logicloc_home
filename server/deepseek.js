import { imageToText } from './ocr.js';

const API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const VISION_BASE = (process.env.DEEPSEEK_VISION_API_BASE || '').replace(/\/+$/, '');
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || '';

const FIELDS_HINT = `字段说明：
- vendor: 销售方/开票方名称
- buyer: 购买方名称
- invoiceNo: 发票号码
- invoiceDate: 开票日期，格式 YYYY-MM-DD
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

async function scanWithVision(base64, mime) {
  const apiKey = process.env.DEEPSEEK_VISION_API_KEY || process.env.DEEPSEEK_API_KEY;
  const base = VISION_BASE || API_BASE;
  const model = VISION_MODEL || MODEL;
  const dataUrl = `data:${mime};base64,${base64}`;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `你是发票识别助手。请从这张发票/收据图片中提取信息，只返回 JSON，不要 markdown 代码块。\n\n${FIELDS_HINT}` },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  });

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

async function scanWithText(ocrText) {
  const prompt = `你是发票识别助手。以下是发票/收据的 OCR 识别文字，请提取结构化信息，只返回 JSON，不要 markdown 代码块。

${FIELDS_HINT}

OCR 文字：
${ocrText}`;
  const result = await chatCompletion([{ role: 'user', content: prompt }]);
  return { ...result, mode: 'ocr', ocrText };
}

export function getAiStatus() {
  const configured = !!process.env.DEEPSEEK_API_KEY;
  let mode = 'disabled';
  if (configured) {
    mode = VISION_BASE && VISION_MODEL ? 'vision' : 'ocr+deepseek';
  }
  return { configured, mode, model: MODEL };
}

export async function scanInvoiceImage(base64, mime = 'image/jpeg') {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY，请在 Railway Variables 中添加');
  }

  if (VISION_BASE && VISION_MODEL) {
    try {
      return await scanWithVision(base64, mime);
    } catch (err) {
      console.warn('[invoice-scan] vision failed, fallback OCR:', err.message);
    }
  }

  const buf = Buffer.from(base64, 'base64');
  const ocrText = await imageToText(buf);
  if (!ocrText || ocrText.replace(/\s/g, '').length < 4) {
    throw new Error('未能从图片识别文字，请上传更清晰的发票照片，或手动填写');
  }

  return scanWithText(ocrText);
}
