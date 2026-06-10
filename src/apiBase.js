/** 生产环境在 Vercel 设置 VITE_API_BASE 为 Railway 后端地址（无末尾斜杠） */
const RAW = import.meta.env.VITE_API_BASE || '';
export const API_BASE = RAW.replace(/\/+$/, '');
export const API = API_BASE ? `${API_BASE}/api` : '/api';

/** 将后端返回的相对资源路径转为完整 URL */
export function assetUrl(path) {
  if (!path || /^https?:\/\//.test(path) || path.startsWith('data:')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}
