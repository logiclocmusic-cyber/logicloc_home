/** 分类卡通图标（Iconify CDN） */

export const ICONIFY_API = 'https://api.iconify.design';
/** 默认图标集：fluent-emoji-flat | twemoji | fluent-emoji | mdi 等 */
export const ICONIFY_COLLECTION = 'fluent-emoji-flat';

export function isIconRef(v) {
  return typeof v === 'string' && /^icon:[0-9A-Fa-f]+$/.test(v);
}

export function isIconifyRef(v) {
  return typeof v === 'string' && /^iconify:[^:]+:.+$/.test(v);
}

export function iconRef(hex) {
  const h = String(hex).replace(/^U\+/i, '').toUpperCase();
  return `icon:${h}`;
}

export function normalizeIconRef(value) {
  if (!value || !isIconRef(value)) return value;
  return iconRef(value.slice(5));
}

export function iconifyRef(collection, name) {
  return `iconify:${collection}:${name}`;
}

export function iconifyUrl(collection, name) {
  return `${ICONIFY_API}/${collection}/${name}.svg`;
}

export function iconUrl(ref) {
  if (isIconifyRef(ref)) {
    const rest = ref.slice(8);
    const sep = rest.indexOf(':');
    if (sep > 0) return iconifyUrl(rest.slice(0, sep), rest.slice(sep + 1));
  }
  const hex = isIconRef(ref) ? ref.slice(5) : String(ref);
  return iconifyUrl(ICONIFY_COLLECTION, hex.toLowerCase());
}

export function legacyEmojiToIconRef(emoji, legacyMap, iconMap) {
  if (!emoji || isIconRef(emoji) || isIconifyRef(emoji)) return emoji;
  for (const [cat, em] of Object.entries(legacyMap || {})) {
    if (em === emoji) {
      const ref = iconMap[cat];
      if (ref && (isIconRef(ref) || isIconifyRef(ref))) return ref;
    }
  }
  return null;
}

export function resolveCatIconValue(cat, stored, { iconMap, legacyMap, nameAliases } = {}) {
  const raw = stored ?? iconMap?.[cat];
  if (raw && (isIconRef(raw) || isIconifyRef(raw))) return normalizeIconRef(raw) || raw;
  const legacy = legacyMap?.[cat];
  if (raw && typeof raw === 'string' && legacy && raw !== legacy) return raw;
  const fromEmoji = legacyEmojiToIconRef(raw, legacyMap, iconMap);
  if (fromEmoji && (isIconRef(fromEmoji) || isIconifyRef(fromEmoji))) return fromEmoji;
  const alias = nameAliases?.[cat];
  if (alias && iconMap?.[alias]) {
    const ref = iconMap[alias];
    if (isIconRef(ref) || isIconifyRef(ref)) return ref;
  }
  if (iconMap?.[cat]) {
    const ref = iconMap[cat];
    if (isIconRef(ref) || isIconifyRef(ref)) return ref;
  }
  return iconRef('1F4CC');
}

export function renderCatIcon(value, opts = {}) {
  const size = opts.size ?? 20;
  const cls = opts.class || '';
  const wrap = opts.wrapClass || '';
  const v = value || '📌';

  if (isIconRef(v) || isIconifyRef(v)) {
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
