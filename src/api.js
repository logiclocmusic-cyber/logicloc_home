import { API } from './apiBase.js';

function authHeaders(extra = {}) {
  const token = sessionStorage.getItem('ledger_session_token');
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableFetchError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || '');
  return msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed');
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = 60000, retryDelayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries && isRetryableFetchError(err)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function fetchState() {
  const res = await fetch(`${API}/state`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('请先登录');
  if (!res.ok) throw new Error(`加载失败 (${res.status})`);
  return res.json();
}

export async function saveState(state) {
  try {
    const res = await fetchWithRetry(`${API}/state`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(state)
    }, { retries: 2, timeoutMs: 90000, retryDelayMs: 2000 });
    if (res.status === 401) throw new Error('登录已过期，请重新登录');
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || '数据已被其他设备更新，请刷新后重试');
      err.code = 'STATE_CONFLICT';
      err.currentVersion = body.currentVersion;
      throw err;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `保存失败 (${res.status})`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('保存超时，数据量较大或网络较慢，请稍后重试');
    if (err.message === 'Failed to fetch') throw new Error('网络连接失败，请检查网络后重试');
    throw err;
  }
}

export async function uploadGearImageFromUrl(gearId, imageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  try {
    const res = await fetch(`${API}/gear/${gearId}/image-from-url`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url: imageUrl }),
      signal: controller.signal,
    });
    if (res.status === 401) throw new Error('登录已过期，请重新登录');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `获取失败 (${res.status})`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时，图片可能过大或网络较慢，请稍后重试');
    if (err.message === 'Failed to fetch') throw new Error('网络连接失败，请检查网络后重试');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadGearImage(gearId, file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  try {
    const res = await fetchWithRetry(`${API}/gear/${gearId}/image`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data, mime: file.type })
    }, { retries: 1, timeoutMs: 60000 });
    if (res.status === 401) throw new Error('登录已过期，请重新登录');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `上传失败 (${res.status})`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('上传超时，请稍后重试');
    if (err.message === 'Failed to fetch') throw new Error('网络连接失败，请检查网络后重试');
    throw err;
  }
}

export async function deleteImportBatchApi(batchId) {
  const res = await fetch(`${API}/import-batches/${encodeURIComponent(batchId)}`, {
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

export async function changeImportBatchSourceApi(batchId, source) {
  const res = await fetch(`${API}/import-batches/${encodeURIComponent(batchId)}/source`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ source })
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `修改失败 (${res.status})`);
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

export async function fetchFamilyEvents() {
  const res = await fetch(`${API}/family-events`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('请先登录');
  if (!res.ok) throw new Error(`加载失败 (${res.status})`);
  return res.json();
}

export async function fetchFamilyEventStorage() {
  const res = await fetch(`${API}/family-events/storage`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) throw new Error(`加载存储信息失败 (${res.status})`);
  return res.json();
}

export async function createFamilyEvent(payload) {
  const res = await fetch(`${API}/family-events`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `创建失败 (${res.status})`);
  }
  return res.json();
}

export async function updateFamilyEvent(id, payload) {
  const res = await fetch(`${API}/family-events/${id}`, {
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

export async function deleteFamilyEvent(id) {
  const res = await fetch(`${API}/family-events/${id}`, {
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

export async function uploadFamilyEventImage(id, file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${API}/family-events/${id}/images`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data, mime: file.type, fileName: file.name })
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `上传失败 (${res.status})`);
  }
  return res.json();
}

export async function deleteFamilyEventImage(id, imageName) {
  const res = await fetch(`${API}/family-events/${id}/images/${encodeURIComponent(imageName)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `删除图片失败 (${res.status})`);
  }
  return res.json();
}
