/** 账单来源平台 LOGO（微信 / 支付宝 / 京东） */

const PLATFORMS = {
  wechat: { bg: '#07c160', icon: 'ti-brand-wechat' },
  alipay: { bg: '#1677ff', icon: 'ti-brand-alipay' },
  jd: {
    bg: '#e1251b',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="15.5" text-anchor="middle" fill="currentColor" font-family="Arial Black,Arial,sans-serif" font-size="8.5" font-weight="700">JD</text></svg>',
  },
};

export function srcPlatformKey(name) {
  const n = String(name || '').trim();
  if (!n || n === 'all') return null;
  if (n.startsWith('微信')) return 'wechat';
  if (n.startsWith('支付宝')) return 'alipay';
  if (n.startsWith('京东')) return 'jd';
  return null;
}

export function srcMarkHtml(name, opts = {}) {
  const size = opts.size ?? 28;
  const fallbackColor = opts.fallbackColor || '#98a2b3';
  const key = srcPlatformKey(name);
  const title = opts.title !== false ? ` title="${String(name).replace(/"/g, '&quot;')}"` : '';

  if (!key) {
    const letter = (String(name || '?').trim()[0] || '?');
    return `<span class="src-mark src-mark-fallback"${title} style="width:${size}px;height:${size}px;background:${fallbackColor}">${letter}</span>`;
  }

  const p = PLATFORMS[key];
  const iconSize = Math.max(12, Math.round(size * 0.52));
  const inner = p.icon
    ? `<i class="ti ${p.icon}" style="font-size:${iconSize}px;line-height:1"></i>`
    : p.svg;
  return `<span class="src-mark src-mark-${key}"${title} style="width:${size}px;height:${size}px;background:${p.bg}">${inner}</span>`;
}
