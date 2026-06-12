/** 从支付方式文本匹配银行品牌色与 Logo（bank.logo 正方形图标） */

const BANK_LOGO_BASE = 'https://cdn.jsdelivr.net/gh/burningmyself/bank.logo@master/resource/logo';

/** 支付宝银行代码 → bank.logo 文件名（少数不一致） */
const LOGO_CODE_ALIAS = {
  HXB: 'HXBANK',
  PAB: 'SPABANK',
};

const BANK_RULES = [
  { patterns: ['招商银行', '招行'], code: 'CMB', colors: ['#c41230', '#8b0e22'], name: '招商银行' },
  { patterns: ['浦发银行', '浦发'], code: 'SPDB', colors: ['#003b8e', '#1565c0'], name: '浦发银行' },
  { patterns: ['建设银行', '建行'], code: 'CCB', colors: ['#0066b3', '#004d8c'], name: '建设银行' },
  { patterns: ['工商银行', '工行'], code: 'ICBC', colors: ['#c41230', '#9a0f26'], name: '工商银行' },
  { patterns: ['农业银行', '农行'], code: 'ABC', colors: ['#00843d', '#006b32'], name: '农业银行' },
  { patterns: ['中国银行', '中行'], code: 'BOC', colors: ['#c41230', '#8f0d1f'], name: '中国银行' },
  { patterns: ['交通银行', '交行'], code: 'COMM', colors: ['#003a8f', '#002d6e'], name: '交通银行' },
  { patterns: ['光大银行', '光大'], code: 'CEB', colors: ['#6b2d8e', '#4a1f63'], name: '光大银行' },
  { patterns: ['中信银行', '中信'], code: 'CITIC', colors: ['#c41230', '#8b0e22'], name: '中信银行' },
  { patterns: ['兴业银行', '兴业'], code: 'CIB', colors: ['#003a8f', '#002566'], name: '兴业银行' },
  { patterns: ['民生银行', '民生'], code: 'CMBC', colors: ['#00857a', '#006b62'], name: '民生银行' },
  { patterns: ['邮储银行', '邮政储蓄', '邮储'], code: 'PSBC', colors: ['#00843d', '#006b32'], name: '邮储银行' },
  { patterns: ['平安银行', '平安'], code: 'PAB', colors: ['#f58220', '#d96b10'], name: '平安银行' },
  { patterns: ['广发银行', '广发'], code: 'GDB', colors: ['#c41230', '#9a0f26'], name: '广发银行' },
  { patterns: ['华夏银行', '华夏'], code: 'HXB', colors: ['#c41230', '#8b0e22'], name: '华夏银行' },
  { patterns: ['北京银行'], code: 'BJBANK', colors: ['#c41230', '#8b0e22'], name: '北京银行' },
  { patterns: ['上海银行'], code: 'SHBANK', colors: ['#1565c0', '#0d47a1'], name: '上海银行' },
  { patterns: ['宁波银行'], code: 'NBBANK', colors: ['#f58220', '#d96b10'], name: '宁波银行' },
  { patterns: ['杭州银行'], code: 'HZBANK', colors: ['#00857a', '#006b62'], name: '杭州银行' },
  { patterns: ['江苏银行'], code: 'JSBANK', colors: ['#1565c0', '#0d47a1'], name: '江苏银行' },
  { patterns: ['南京银行'], code: 'NJCB', colors: ['#c41230', '#8b0e22'], name: '南京银行' },
  { patterns: ['支付宝', '花呗', '余额宝'], code: 'ALIPAY', colors: ['#1677ff', '#0958d9'], name: '支付宝' },
  { patterns: ['微信', '零钱'], code: 'WECHAT', colors: ['#07c160', '#059a4c'], name: '微信支付' },
  { patterns: ['云闪付', '银联'], code: 'UPOP', colors: ['#e21836', '#b5122b'], name: '云闪付' },
];

export function isValidPayAccount(pay) {
  const s = (pay || '').trim();
  if (!s) return false;
  if (/^[\/\-—·.]+$/.test(s)) return false;
  if (s === '无' || s === '未知' || s === 'null' || s === 'undefined') return false;
  return true;
}

const MERGE_GROUPS = [
  { code: 'WECHAT', key: '__grp:微信支付', name: '微信支付' },
];

export function accountGroupKey(payText) {
  const brand = matchBankBrand(payText);
  const merged = MERGE_GROUPS.find(g => g.code === brand?.code);
  return merged ? merged.key : (payText || '').trim();
}

export function accountGroupName(key) {
  const merged = MERGE_GROUPS.find(g => g.key === key);
  if (merged) return merged.name;
  return null;
}

const NO_LOGO_FILE = new Set(['HZBANK', 'UPOP']);

function bankLogoUrl(code) {
  if (['WECHAT', 'ALIPAY', 'UPOP'].includes(code) || NO_LOGO_FILE.has(code)) return null;
  const fileCode = LOGO_CODE_ALIAS[code] || code;
  return `${BANK_LOGO_BASE}/${fileCode}.png`;
}

export function matchBankBrand(payText) {
  const text = (payText || '').trim();
  for (const rule of BANK_RULES) {
    if (rule.patterns.some(p => text.includes(p))) {
      return {
        code: rule.code,
        colors: rule.colors,
        name: rule.name,
        logoType: ['WECHAT', 'ALIPAY', 'UPOP'].includes(rule.code) ? rule.code : 'bank',
        logoUrl: bankLogoUrl(rule.code)
      };
    }
  }
  return null;
}
