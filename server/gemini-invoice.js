const GEMINI_BASE = String(process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com')
  .trim()
  .replace(/\/+$/, '');

const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

export function geminiEnabled() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

export function geminiModelName() {
  return resolveModelList()[0];
}

function configuredModel() {
  const raw = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
  if (/2\.0-flash/i.test(raw)) return 'gemini-2.5-flash-lite';
  return raw || 'gemini-2.5-flash-lite';
}

function resolveModelList() {
  const preferred = configuredModel();
  const list = [preferred];
  for (const model of FALLBACK_MODELS) {
    if (!list.includes(model)) list.push(model);
  }
  return list;
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }
  return null;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('\n').trim();
}

function quotaErrorHelp(msg, model) {
  const text = String(msg || '');
  const oldModel = /2\.0-flash/i.test(text) || /2\.0-flash/i.test(model);
  const parts = [
    'Gemini 配额不足（429）。',
    oldModel
      ? 'gemini-2.0-flash 已停用且免费配额为 0，请改用 gemini-2.5-flash-lite。'
      : null,
    '若你还没成功识别过，通常不是真的“用完了”，而是：',
    '① 该模型在你账号的免费档限额为 0；',
    '② Google 项目尚未关联付款方式（在 AI Studio 添加结算方式可激活免费额度，不必开通付费）；',
    '③ API Key 所在项目被限制。',
    '建议：config.env 设为 GEMINI_MODEL=gemini-2.5-flash-lite，并在 aistudio.google.com 的 API Keys 页查看 Rate limits。',
  ].filter(Boolean);
  return parts.join(' ');
}

function geminiApiError(status, bodyText, model) {
  const payload = parseJsonFromText(bodyText);
  const msg = payload?.error?.message || bodyText || `HTTP ${status}`;
  const code = payload?.error?.code || status;
  if (code === 429 || status === 429) {
    const err = new Error(quotaErrorHelp(msg, model));
    err.isQuota = true;
    throw err;
  }
  if (code === 403 || status === 403) {
    throw new Error(`Gemini API Key 无效或无权限：${msg.slice(0, 180)}`);
  }
  if (code === 404 || status === 404 || /not found|shut down|deprecated/i.test(msg)) {
    throw new Error(
      `Gemini 模型不可用（${model}）。请在 config.env 改为 GEMINI_MODEL=gemini-2.5-flash-lite 后重启应用。`
    );
  }
  throw new Error(`Gemini API 错误 (${code})：${msg.slice(0, 220)}`);
}

async function geminiGenerateOnce(model, parts, { json = true } = {}) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('未配置 GEMINI_API_KEY');

  const url = `${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const configs = json
    ? [{ responseMimeType: 'application/json' }, {}]
    : [{}];

  let lastParseErr = '';
  for (const generationConfig of configs) {
    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        ...generationConfig,
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      geminiApiError(res.status, bodyText, model);
    }
    const data = parseJsonFromText(bodyText) || {};
    const text = extractGeminiText(data);
    const parsed = parseJsonFromText(text);
    if (parsed) return { parsed, raw: text, model };
    lastParseErr = text || bodyText.slice(0, 300);
  }

  throw new Error(`Gemini 返回无法解析${lastParseErr ? `：${lastParseErr.slice(0, 240)}` : ''}`);
}

async function geminiGenerate(parts, { json = true } = {}) {
  const models = resolveModelList();
  let lastErr = null;
  for (const model of models) {
    try {
      return await geminiGenerateOnce(model, parts, { json });
    } catch (err) {
      lastErr = err;
      if (!err?.isQuota || model === models[models.length - 1]) throw err;
      console.warn(`[gemini] ${model} quota error, trying fallback`);
    }
  }
  throw lastErr || new Error('Gemini 调用失败');
}

export async function scanInvoiceWithGemini(buf, mime, { prompt, fileName = '' } = {}) {
  if (!geminiEnabled()) throw new Error('未配置 GEMINI_API_KEY');
  const base64 = Buffer.isBuffer(buf) ? buf.toString('base64') : String(buf || '');
  const mediaMime = mime || 'image/jpeg';
  const parts = [
    { text: prompt },
    { inline_data: { mime_type: mediaMime, data: base64 } },
  ];
  const result = await geminiGenerate(parts, { json: true });
  return { ...result, mode: 'gemini', fileName };
}

export async function scanInvoiceTextWithGemini(prompt) {
  if (!geminiEnabled()) throw new Error('未配置 GEMINI_API_KEY');
  const result = await geminiGenerate([{ text: prompt }], { json: true });
  return { ...result, mode: 'gemini' };
}
