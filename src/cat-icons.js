/** 分类卡通图标（OpenMoji 彩色 SVG） */

export const OPENMOJI_CDN = 'https://cdn.jsdelivr.net/npm/openmoji@15.1.0/color/svg';

export function isIconRef(v) {
  return typeof v === 'string' && /^icon:[0-9A-Fa-f]+$/.test(v);
}

export function iconRef(hex) {
  const h = String(hex).replace(/^U\+/i, '').toUpperCase();
  return `icon:${h}`;
}

export function iconUrl(ref) {
  const hex = isIconRef(ref) ? ref.slice(5) : String(ref).toUpperCase();
  return `${OPENMOJI_CDN}/${hex}.svg`;
}

export function renderCatIcon(value, opts = {}) {
  const size = opts.size ?? 20;
  const cls = opts.class || '';
  const wrap = opts.wrapClass || '';
  const v = value || '📌';

  if (isIconRef(v)) {
    const img = `<img class="${cls || 'cat-icon-img'}" src="${iconUrl(v)}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async">`;
    return wrap ? `<span class="${wrap}">${img}</span>` : img;
  }

  const emojiCls = cls || 'cat-icon-emoji';
  const inner = `<span class="${emojiCls}">${v}</span>`;
  return wrap ? `<span class="${wrap}">${inner}</span>` : inner;
}

export const CARTOON_ICON_QUICK = [
  iconRef('1F374'), iconRef('1F6CD'), iconRef('1F9FB'), iconRef('1F697'),
  iconRef('1F966'), iconRef('1F353'), iconRef('1F36D'), iconRef('1F3D3'),
  iconRef('1F47B'), iconRef('1F4F1'), iconRef('1F455'), iconRef('1F486'),
  iconRef('1F682'), iconRef('1F37D'), iconRef('1F6D2'), iconRef('1F4BB'),
  iconRef('1F4A1'), iconRef('1F527'), iconRef('1F3E0'), iconRef('1F3AD'),
  iconRef('1F476'), iconRef('1F3E5'), iconRef('1F43E'), iconRef('1F6E1'),
  iconRef('1F3DB'), iconRef('1F4BC'), iconRef('1F4B8'), iconRef('1F9E7'),
  iconRef('267B'), iconRef('1F3AE'), iconRef('1F4F9'), iconRef('1F3D8'),
  iconRef('1F4C8'), iconRef('1F4B0'), iconRef('1F4B5'), iconRef('1F4CC'),
];
