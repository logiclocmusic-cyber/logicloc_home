/** 网站账号平台 LOGO：按名称模糊匹配品牌图标 / 站点 favicon / 本地图 */

import { matchBankBrand } from './bank-brands.js';

const FAVICON = (domain) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

/**
 * aliases: 规范化后匹配用（大小写、空格、标点已剥离）
 * bg: 底色
 * icon: Tabler 图标类名（无 ti- 前缀也可，统一补全）
 * domain: 用于 Google favicon
 * logoUrl: 直接图片地址（本地或 CDN），优先于 domain
 */
const WEB_PLATFORM_RULES = [
  { aliases: ['微信', 'wechat', 'weixin', 'weixinpay'], bg: '#07c160', icon: 'ti-brand-wechat' },
  { aliases: ['支付宝', 'alipay', 'zhifubao'], bg: '#1677ff', icon: 'ti-brand-alipay' },
  { aliases: ['小红书', 'xiaohongshu', 'rednote', 'xhs'], bg: '#ff2442', logoUrl: '/web-logos/xiaohongshu.png' },
  { aliases: ['抖音', 'douyin', 'tiktok', '抖音火山'], bg: '#111111', domain: 'douyin.com' },
  { aliases: ['instagram', 'ins', 'ig'], bg: '#E4405F', domain: 'instagram.com', icon: 'ti-brand-instagram' },
  { aliases: ['netflix', '奈飞', '网飞'], bg: '#E50914', domain: 'netflix.com', icon: 'ti-brand-netflix' },
  { aliases: ['嘉信理财', '嘉信', 'schwab', 'charlesschwab'], bg: '#00a0df', domain: 'schwab.com' },
  { aliases: ['长桥', 'longbridge', '长桥证券'], bg: '#1a56db', domain: 'longbridge.com' },
  { aliases: ['天府通办', '天府通', 'sczwfw'], bg: '#c41230', domain: 'www.sczwfw.gov.cn' },
  { aliases: ['电子税务局', '税务局', 'etax', 'chinatax', '国税'], bg: '#c41230', domain: 'etax.chinatax.gov.cn' },
  { aliases: ['汇丰香港', '汇丰', 'hsbc', '汇丰银行'], bg: '#db0011', logoUrl: '/bank-logos/hsbc.png' },
  { aliases: ['中银香港', '中银', 'bochk', 'bankofchinahongkong', '中银hk'], bg: '#c41230', domain: 'www.bochk.com' },
  { aliases: ['众安银行', '众安', 'zabank', 'zabankhk'], bg: '#00b140', domain: 'bank.za.group' },
  { aliases: ['乐极客', '乐极客公司', 'logicloc', 'logicgeek', 'lejike'], bg: '#2563eb', icon: 'ti-building' },
  { aliases: ['ssrdog', 'ssr狗'], bg: '#1e3a6e', logoUrl: '/web-logos/ssrdog.png' },
  { aliases: ['photosmobile', 'photos', 'applephotos', 'iphoto'], bg: '#007aff', icon: 'ti-brand-apple' },
  { aliases: ['光猫超级密码', '光猫', 'modem', 'router', '超级密码'], bg: '#64748b', icon: 'ti-router' },
  { aliases: ['github', 'gh'], bg: '#181717', domain: 'github.com', icon: 'ti-brand-github' },
  { aliases: ['google', '谷歌'], bg: '#4285F4', domain: 'google.com', icon: 'ti-brand-google' },
  { aliases: ['apple', '苹果', 'icloud'], bg: '#555555', domain: 'apple.com', icon: 'ti-brand-apple' },
  { aliases: ['twitter', '推特', 'x.com'], bg: '#000000', domain: 'x.com', icon: 'ti-brand-x' },
  { aliases: ['facebook', 'fb', '脸书'], bg: '#1877F2', domain: 'facebook.com', icon: 'ti-brand-facebook' },
  { aliases: ['youtube', 'yt', '油管'], bg: '#FF0000', domain: 'youtube.com', icon: 'ti-brand-youtube' },
  { aliases: ['linkedin', '领英'], bg: '#0A66C2', domain: 'linkedin.com', icon: 'ti-brand-linkedin' },
  { aliases: ['amazon', '亚马逊'], bg: '#FF9900', domain: 'amazon.com', icon: 'ti-brand-amazon' },
  { aliases: ['淘宝', 'taobao'], bg: '#ff5000', domain: 'taobao.com' },
  { aliases: ['京东', 'jd', 'jingdong'], bg: '#e1251b', domain: 'jd.com' },
  { aliases: ['拼多多', 'pdd', 'pinduoduo'], bg: '#e02e24', domain: 'pinduoduo.com' },
  { aliases: ['哔哩哔哩', 'bilibili', 'b站', 'bili'], bg: '#00A1D6', domain: 'bilibili.com' },
  { aliases: ['腾讯视频', 'tencentvideo'], bg: '#ff6682', domain: 'v.qq.com' },
  { aliases: ['爱奇艺', 'iqiyi'], bg: '#00be06', domain: 'iqiyi.com' },
  { aliases: ['美团', 'meituan'], bg: '#FFD100', domain: 'meituan.com' },
  { aliases: ['饿了么', 'eleme', 'elm'], bg: '#0097ff', domain: 'ele.me' },
  { aliases: ['滴滴', 'didi'], bg: '#ff7d41', domain: 'didiglobal.com' },
  { aliases: ['携程', 'ctrip'], bg: '#2681ff', domain: 'ctrip.com' },
  { aliases: ['飞书', 'lark', 'feishu'], bg: '#00d6b9', domain: 'feishu.cn' },
  { aliases: ['钉钉', 'dingtalk', 'dingding'], bg: '#0089ff', domain: 'dingtalk.com' },
  { aliases: ['企业微信', 'wecom', 'wxwork'], bg: '#2786ef', domain: 'work.weixin.qq.com' },
];

function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 规范化平台名：小写、去空白/标点、去掉常见后缀 */
export function normalizeWebPlatformTitle(title = '') {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·•._\-—–'"`()（）【】\[\]{}]/g, '')
    .replace(/(公司|平台|账号|账户|官网|网站|app|应用)$/g, '');
}

function aliasKey(alias) {
  return normalizeWebPlatformTitle(alias);
}

const NORMALIZED_RULES = WEB_PLATFORM_RULES.map(rule => ({
  ...rule,
  keys: (rule.aliases || []).map(aliasKey).filter(Boolean).sort((a, b) => b.length - a.length)
}));

/**
 * @returns {{ bg: string, icon?: string, logoUrl?: string, domain?: string, name?: string } | null}
 */
export function matchWebPlatform(title = '') {
  const raw = String(title || '').trim();
  if (!raw) return null;
  const key = normalizeWebPlatformTitle(raw);
  if (!key) return null;

  let best = null;
  let bestScore = 0;
  for (const rule of NORMALIZED_RULES) {
    for (const a of rule.keys) {
      if (!a) continue;
      let score = 0;
      if (key === a) {
        score = 1000 + a.length;
      } else {
        // 短别名（x/ig/fb 等）只做精确匹配，避免误伤「未知平台XYZ」
        const aliasOk = a.length >= 3 || (a.length >= 2 && /[\u4e00-\u9fff]/.test(a));
        const keyOk = key.length >= 3 || (key.length >= 2 && /[\u4e00-\u9fff]/.test(key));
        if (aliasOk && key.includes(a)) score = 500 + a.length;
        else if (aliasOk && keyOk && a.includes(key)) score = 300 + key.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }
  }
  if (best) {
    return {
      bg: best.bg,
      icon: best.icon,
      logoUrl: best.logoUrl || (best.domain ? FAVICON(best.domain) : null),
      domain: best.domain || null,
      name: best.aliases?.[0] || raw
    };
  }

  // 银行类回退（汇丰 / 中行等）
  const bank = matchBankBrand(raw);
  if (bank) {
    return {
      bg: bank.colors?.[0] || '#64748b',
      logoUrl: bank.logoUrl || null,
      icon: bank.logoType === 'WECHAT' ? 'ti-brand-wechat'
        : bank.logoType === 'ALIPAY' ? 'ti-brand-alipay'
          : null,
      name: bank.name
    };
  }
  return null;
}

function platformInitial(title = '') {
  const s = String(title || '').trim();
  if (!s) return '?';
  return Array.from(s)[0];
}

function iconClass(icon) {
  if (!icon) return '';
  return icon.startsWith('ti ') || icon.startsWith('ti-') ? (icon.startsWith('ti ') ? icon : `ti ${icon}`) : `ti ${icon}`;
}

/**
 * 平台卡片左侧 LOGO HTML（40px 默认）
 * 优先 logo 图 → Tabler 图标 → 首字母占位
 */
export function webPlatformMarkHtml(title = '', { size = 40 } = {}) {
  const matched = matchWebPlatform(title);
  const letter = platformInitial(title);
  const bg = matched?.bg || '#64748b';
  const style = `width:${size}px;height:${size}px;background:${bg}`;
  const logoUrl = matched?.logoUrl || null;
  const icon = matched?.icon ? iconClass(matched.icon) : '';

  if (logoUrl) {
    const iconSize = Math.max(14, Math.round(size * 0.48));
    const fallbackInner = icon
      ? `<i class="${icon}" style="font-size:${iconSize}px;line-height:1" hidden data-web-logo-fb></i>`
      : `<span hidden data-web-logo-fb>${escAttr(letter)}</span>`;
    return `<span class="accounts-web-entry-card-icon has-logo" style="${style}" aria-hidden="true">
      <img class="accounts-web-entry-card-logo" src="${escAttr(logoUrl)}" alt="" width="${size}" height="${size}" loading="lazy"
        onerror="this.style.display='none';var fb=this.parentElement&&this.parentElement.querySelector('[data-web-logo-fb]');if(fb){fb.hidden=false;}this.parentElement&&this.parentElement.classList.add('is-fallback');">
      ${fallbackInner}
    </span>`;
  }

  if (icon) {
    const iconSize = Math.max(14, Math.round(size * 0.52));
    return `<span class="accounts-web-entry-card-icon has-icon" style="${style}" aria-hidden="true"><i class="${icon}" style="font-size:${iconSize}px;line-height:1"></i></span>`;
  }

  return `<span class="accounts-web-entry-card-icon" style="${style}" aria-hidden="true">${escAttr(letter)}</span>`;
}


/** 网站账号平台分组（可维护映射；未知 → other） */
export const WEB_PLATFORM_CATEGORIES = [
  { id: 'social', label: '社交平台', icon: 'ti-users', order: 10 },
  { id: 'invest', label: '投资理财', icon: 'ti-chart-line', order: 20 },
  { id: 'bank', label: '银行金融', icon: 'ti-building-bank', order: 30 },
  { id: 'gov', label: '政务税务', icon: 'ti-building-community', order: 40 },
  { id: 'company', label: '公司账户', icon: 'ti-building', order: 50 },
  { id: 'device', label: '设备网络', icon: 'ti-device-desktop', order: 60 },
  { id: 'media', label: '影音订阅', icon: 'ti-device-tv', order: 70 },
  { id: 'other', label: '其它', icon: 'ti-dots', order: 999 },
];

/** 规范化平台名 → 类别 id（精确优先，再模糊包含） */
const WEB_PLATFORM_CATEGORY_ALIASES = [
  // 社交
  { cat: 'social', aliases: ['小红书', 'xiaohongshu', 'rednote', 'xhs', '微信', 'wechat', 'weixin', '抖音', 'douyin', 'tiktok', 'instagram', 'ins', 'facebook', 'fb', 'twitter', 'linkedin', '领英', '微博', 'weibo'] },
  // 投资
  { cat: 'invest', aliases: ['嘉信理财', '嘉信', 'schwab', '长桥', 'longbridge', '富途', 'futu', '老虎', 'tiger', '雪球', 'xueqiu'] },
  // 银行
  { cat: 'bank', aliases: ['汇丰香港', '汇丰', 'hsbc', '中银香港', '中银', 'bochk', '众安银行', '众安', 'zabank', '支付宝', 'alipay'] },
  // 政务
  { cat: 'gov', aliases: ['电子税务局', '税务局', 'etax', 'chinatax', '天府通办', '天府通', 'sczwfw'] },
  // 公司
  { cat: 'company', aliases: ['乐极客', '乐极客公司', 'logicloc', 'logicgeek', 'lejike'] },
  // 设备网络
  { cat: 'device', aliases: ['ssrdog', 'ssr狗', '光猫超级密码', '光猫', 'modem', 'router', '超级密码', 'photosmobile', 'photos', 'applephotos'] },
  // 影音
  { cat: 'media', aliases: ['netflix', '奈飞', 'youtube', '哔哩哔哩', 'bilibili', 'b站', '腾讯视频', '爱奇艺', 'iqiyi', 'spotify'] },
];

function categoryAliasKey(s) {
  return normalizeWebPlatformTitle(s);
}

const NORMALIZED_CATEGORY_RULES = WEB_PLATFORM_CATEGORY_ALIASES.map(rule => ({
  cat: rule.cat,
  keys: (rule.aliases || []).map(categoryAliasKey).filter(Boolean).sort((a, b) => b.length - a.length)
}));

export function matchWebPlatformCategory(title = '') {
  const key = normalizeWebPlatformTitle(title);
  if (!key) return 'other';
  let best = null;
  let bestScore = 0;
  for (const rule of NORMALIZED_CATEGORY_RULES) {
    for (const a of rule.keys) {
      if (!a) continue;
      let score = 0;
      if (key === a) score = 1000 + a.length;
      else {
        const aliasOk = a.length >= 3 || (a.length >= 2 && /[\u4e00-\u9fff]/.test(a));
        const keyOk = key.length >= 3 || (key.length >= 2 && /[\u4e00-\u9fff]/.test(key));
        if (aliasOk && key.includes(a)) score = 500 + a.length;
        else if (aliasOk && keyOk && a.includes(key)) score = 300 + key.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = rule.cat;
      }
    }
  }
  if (best) return best;
  // bank fallback via bank brand matcher
  try {
    const bank = matchBankBrand(String(title || ''));
    if (bank && !['WECHAT', 'ALIPAY', 'UPOP'].includes(bank.code)) return 'bank';
    if (bank?.code === 'WECHAT') return 'social';
    if (bank?.code === 'ALIPAY') return 'bank';
  } catch (_) { /* ignore */ }
  return 'other';
}

export function webPlatformCategoryMeta(catId) {
  return WEB_PLATFORM_CATEGORIES.find(c => c.id === catId) || WEB_PLATFORM_CATEGORIES[WEB_PLATFORM_CATEGORIES.length - 1];
}

/** 将平台列表按类别分组；只返回有平台的组，按 order 排序 */
export function groupWebPlatformsByCategory(platforms = []) {
  const buckets = new Map();
  for (const p of platforms || []) {
    const cat = matchWebPlatformCategory(p?.title || '');
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(p);
  }
  return WEB_PLATFORM_CATEGORIES
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter(c => buckets.has(c.id) && buckets.get(c.id).length)
    .map(c => ({
      ...c,
      platforms: buckets.get(c.id)
    }));
}
