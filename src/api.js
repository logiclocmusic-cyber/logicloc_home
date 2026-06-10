import { API } from './apiBase.js';

function authHeaders(extra = {}) {
  const token = sessionStorage.getItem('ledger_session_token');
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchState() {
  const res = await fetch(`${API}/state`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('请先登录');
  if (!res.ok) throw new Error(`加载失败 (${res.status})`);
  return res.json();
}

export async function saveState(state) {
  const res = await fetch(`${API}/state`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(state)
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (res.status === 409) {
    const err = new Error('数据已被其他设备更新，请刷新后重试');
    err.code = 'STATE_CONFLICT';
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `保存失败 (${res.status})`);
  }
  return res.json();
}

export async function uploadGearImage(gearId, file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${API}/gear/${gearId}/image`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data, mime: file.type })
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `上传失败 (${res.status})`);
  }
  return res.json();
}

export async function resetLedger() {
  const res = await fetch(`${API}/reset-ledger`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ confirm: 'RESET_ALL_TRANSACTIONS' })
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `清空失败 (${res.status})`);
  }
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error('服务不可用');
  return res.json();
}

export async function fetchInvoiceAiStatus() {
  const res = await fetch(`${API}/invoices/ai-status`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) return { configured: false, mode: 'disabled' };
  return res.json();
}

export async function fetchInvoices() {
  const res = await fetch(`${API}/invoices`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) throw new Error(`加载失败 (${res.status})`);
  return res.json();
}

export async function scanInvoice(dataUrl, mime, fileName) {
  const res = await fetch(`${API}/invoices/scan`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: dataUrl, mime, fileName })
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `识别失败 (${res.status})`);
  }
  return res.json();
}

export async function createInvoice(payload) {
  const res = await fetch(`${API}/invoices`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `保存失败 (${res.status})`);
  }
  return res.json();
}

export async function updateInvoice(id, payload) {
  const res = await fetch(`${API}/invoices/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `更新失败 (${res.status})`);
  }
  return res.json();
}

export async function deleteInvoice(id) {
  const res = await fetch(`${API}/invoices/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `删除失败 (${res.status})`);
  }
  return res.json();
}
