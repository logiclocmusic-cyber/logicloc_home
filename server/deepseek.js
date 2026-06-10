const API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const INVOICE_PROMPT = `你是发票识别助手。请从这张发票/收据图片中提取信息，只返回 JSON，不要 markdown 代码块，不要其他说明。

字段说明：
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

export async function scanInvoiceImage(base64, mime = 'image/jpeg') {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');

  const dataUrl = `data:${mime};base64,${base64}`;
  const body = {
    model: MODEL,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: INVOICE_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  };

  let res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, response_format: { type: 'json_object' } })
  });

  if (!res.ok) {
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

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || '';
  try {
    return { parsed: JSON.parse(text), raw: text };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return { parsed: JSON.parse(match[0]), raw: text };
    throw new Error('AI 返回格式无法解析');
  }
}
